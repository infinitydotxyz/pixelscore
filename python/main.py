"""Computes Deep Pixelscore for a single NFT collection.

Score is based only  on the information from the given collection, independent
from other collections. 'Deep' means that the score of a given NFT is based
on the output of the 128-neurons dense layer when this NFT is passed through
EfficientNet. The neurons that fall within less frequent ranges will are
considered rare and the score of the given NFT is the average of the 128 neuron
rarities.

EfficientNet used for rarity scoring is initialized from imagenet and fine-tuned
on the givel collection with ground-truth raritySroce provided by Mavriklabs
exchange.

This script reads and writes all the data into FLAGS.base_dir.

example run:
python3 pixelscore_service/within_collection_score/main.py
  --collection_id='0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
  --base_dir=/mnt/disks/ssd/data

"""

import numpy
import pandas as pd
import sklearn
import scipy
import tensorflow as tf
from tensorflow import keras
import matplotlib.pyplot as plt
import os
import gc
import sys
import numpy as np
from PIL import Image
from absl import app
from absl import flags

from sklearn.preprocessing import KBinsDiscretizer
from sklearn.preprocessing import MinMaxScaler

from tensorflow.keras.applications.efficientnet import preprocess_input, decode_predictions
from keras import backend as K
from numpy import savez_compressed

# Global constants, don't touch them.
# Pixelscore will be scaled in (SCALING_MIN, SCALING_MAX)
PIXELSCORE_SCALING_MIN = 0.0
PIXELSCORE_SCALING_MAX = 10.0
# Default classes in pre-trained EfficientNet.
N_CLASSES_STANDARD_MODEL = 1000
# Read only MAX_EXAMPLES from collection, set to 100K to read everything.
MAX_EXAMPLES = 100000
# Image dimension for EfficientNet.
EFFICIENTNET_IMAGE_SIZE = 224
# Number of bins for pixel rarity score, must be less than collection size.
PIXEL_SCORE_BINS = 10

FLAGS = flags.FLAGS
flags.DEFINE_string(
    'collection_id',
    '0x9a534628b4062e123ce7ee2222ec20b86e16ca8f',
    'Collection id.')
flags.DEFINE_string(
    'base_dir',
    '/mnt/disks/ssd/data',
    'Local base directory containing images.')
flags.DEFINE_boolean(
    'use_checkpoint',
    True,
    'Whether to use model checkpoint transfer learned for the given collection. If False, base EfficientNet with imagenet weights is used.')


def load_collection_numpy(base_dir, collection_id):
    """Loads nft collection pixels as archived numpy array.

    Loads from  base_dir/<collection_id>/numpy/pixels.npz and
    base_dir/<collection_id>/numpy/ids.npz

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
    Returns:
      X_train: np array with flattened pixels form entire collection e.g. [collection_length, 224 * 224]
      ids: np array with local nft ids for the given collection e.g. [collection_length]
    """
    # Load pixels.
    path = base_dir + '/{}'.format(collection_id) + '/numpy'
    filename = path + '/pixels.npz'
    X_train = np.load(filename)['arr_0']
    print('Loading pixels as numpy from {}'.format(filename))
    # Load ids.
    filename = path + '/ids.npz'
    ids = np.load(filename)['arr_0']
    print('Loading ids as numpy from {}'.format(filename))
    return X_train, ids


def save_collection_numpy(base_dir, collection_id, X_train):
    """Saves nft collection pixels as archived numpy array.

    Saves to base_dir/<collection_id>/numpy/dnn_layers.npz

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      X_train: np array with flattened pixels form entire collection e.g. [collection_length, 224 * 224]
    Returns:
      True if collection was saved as numpy.
    """
    path = base_dir + '/{}'.format(collection_id) + '/numpy'
    if not os.path.exists(path):
        os.system('sudo mkdir {}'.format(path))
    filename = path + '/dnn_layers.npz'
    savez_compressed('dnn_layers.npz', X_train)
    print('Saving layers as numpy to {}'.format(filename))
    os.system('sudo mv dnn_layers.npz {}'.format(filename))
    return True


def save_collection_scores(base_dir, collection_id, df):
    """Saves pixel scores for the given collection in .csv.

    Saves to base_dir/<collection_id>/pixelscore/pixelscore.npz
    Saves histogram to base_dir/<collection_id>/pixelscore/hist.png

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      df: dataframe with columns at least 'id' and 'PixelScore'

    Returns:
      True if collection was saved as numpy.
    """
    # Save PixelScore.
    path = base_dir + '/{}'.format(collection_id) + '/pixelscore'
    if not os.path.exists(path):
        os.system('sudo mkdir {}'.format(path))
    filename = path + '/pixelscore.csv'
    df.to_csv('pixelscore.csv')
    print('Saving layers as numpy to {}'.format(filename))
    os.system('sudo mv pixelscore.csv {}'.format(filename))
    # Saev histogram.
    filename = path + '/hist.png'
    scores = df['PixelScore'].values
    fig = plt.hist(scores, bins=28)
    plt.title('Hist pixelscore')
    plt.xlabel("pixelscore")
    plt.ylabel("Frequency")
    plt.savefig('hist.png')
    os.system('sudo mv hist.png {}'.format(filename))
    return True


def load_standard_model():
    """Loads pretrained EfficientNet with imagenet weights."""
    base_model = tf.keras.applications.EfficientNetB0(
        include_top=False,
        input_shape=(
            EFFICIENTNET_IMAGE_SIZE,
            EFFICIENTNET_IMAGE_SIZE,
            3),
        weights="imagenet",
        classes=N_CLASSES_STANDARD_MODEL)
    return base_model


def load_checkpoint(base_dir, collection_id):
    """Loads EfficientNet checkpoint, architecture may be modified from base.

    Loads from base_dir/<collection_id>/tf_logs/model

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'

    Returns:
      model: Keras model.
    """
    model_path = base_dir + '/{}'.format(collection_id) + '/tf_logs/model'
    model = tf.keras.models.load_model(model_path)
    # Check its architecture
    print(model.summary())
    return model


def get_layer_output_nft(img_path, model):
    """Gets DNN layer output for a given image, single raw image.

    Args:
      img_path: path to image
      model: Keras model.

    Returns:
      layer_output: np array with layer output, typically [128]
    """
    print('Loading image from {}'.format(img_path))
    img = Image.open(img_path)
    img = img.convert('RGB')
    img_array = np.array(img)
    img_batch = np.expand_dims(img_array, axis=0)
    layer_name = 'dense_3'
    intermediate_layer_model = keras.models.Model(
        inputs=model.input, outputs=model.get_layer(layer_name).output)
    intermediate_output = intermediate_layer_model.predict(img_batch)
    layer_output = intermediate_output
    print('Obtained Layer output with shape: {}'.format(layer_output.shape))
    del img
    gc.collect()
    return layer_output


def get_layer_output_collection(base_dir, collection_id, model):
    """Gets DNN layer output for entire collection from raw images.

    Reads from base_dir/<collection_id>/resized.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      model: Keras model

    Returns:
      X_train: np array with layer output, typically [collection_size, 128]
      ids: np array with local nft ids for the given collection e.g. [collection_length]
    """
    collection_folder = base_dir + '/{}'.format(collection_id) + '/resized'
    output_array = []
    ids = []
    count = 0
    for f in os.listdir(collection_folder):
        path = collection_folder + '/{}'.format(f)
        layer_output = get_layer_output_nft(path, model).flatten()
        output_array.append(layer_output)
        ids.append(f)
        print(len(output_array))
        count += 1
        if count > MAX_EXAMPLES:
            break
    X_train = np.array(output_array)
    print(X_train.shape)
    save_collection_numpy(base_dir, collection_id, X_train)
    return X_train, ids


def get_layer_output_collection_from_numpy(base_dir, collection_id, model):
    """Gets DNN layer output for entire collection from previously saved numpy.

    Faster than getting layer from raw images.
    Reads from base_dir/<collection_id>/numpy/pixels.npz.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      model: Keras model

    Returns:
      layer_output: np array with layer output, typically [collection_size, 128]
      ids: np array with local nft ids for the given collection e.g. [collection_length]
    """
    X_train, ids = load_collection_numpy(base_dir, collection_id)
    # TODO(dstorcheus): If needed process layer outputs per batch.
    print('Getting model layer output for the entire collection at once, takes a few mins.')
    layer_name = 'dense_3'
    intermediate_layer_model = keras.models.Model(
        inputs=model.input, outputs=model.get_layer(layer_name).output)
    intermediate_output = intermediate_layer_model.predict(X_train)
    layer_output = intermediate_output
    print('Obtained Layer output with shape: {}'.format(layer_output.shape))
    gc.collect()
    save_collection_numpy(base_dir, collection_id, layer_output)
    return layer_output, ids


def get_scores_collection(X_train, ids):
    """Computes Pixelscores for a given collection from dnn layer neurons.

    Args:
      X_train: np array DNN layer output [colelction_size, 128]
      ids: np array local colelciton ids [colelction_size]

    Returns:
      df: Datafram with column 'PixelScore' and 'id'
    """
    pixel_scores = []
    # Obtain histograms.
    est = KBinsDiscretizer(
        n_bins=PIXEL_SCORE_BINS,
        encode='ordinal',
        strategy='kmeans')
    print('Fitting KBinsDiscretizer to break layer values into bins.')
    est.fit(X_train)
    Xt = est.transform(X_train)
    # Xt are the actual scores.
    scores = np.mean(Xt, axis=1)
    # Scale the scores for fixed range
    scaler = MinMaxScaler(
        feature_range=(
            PIXELSCORE_SCALING_MIN,
            PIXELSCORE_SCALING_MAX))
    scores = scaler.fit_transform(scores.reshape(-1, 1))
    df = pd.DataFrame()
    df['id'] = ids
    df['PixelScore'] = scores
    print('Head df with PixelScore')
    print(df.head(10))
    (unique, counts) = np.unique(Xt, return_counts=True)
    # Counts of each bin value.
    frequencies = np.asarray((unique, counts)).T
    Xt = Xt.flatten()
    return df


def main(argv):
    if FLAGS.collection_id is not None:
        print('Generating Scres for collection {}'.format(FLAGS.collection_id))
    if FLAGS.use_checkpoint:
        model = load_checkpoint(FLAGS.base_dir, FLAGS.collection_id)
    else:
        model = load_standard_model()
    X_train, ids = get_layer_output_collection_from_numpy(
        FLAGS.base_dir, FLAGS.collection_id, model)
    df = get_scores_collection(X_train, ids)
    save_collection_scores(FLAGS.base_dir, FLAGS.collection_id, df)
    print(
        'Completed Score generation for collection {}'.format(
            FLAGS.collection_id))
    print('Success')


if __name__ == '__main__':
    app.run(main)
