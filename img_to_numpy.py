"""Converts folder of images to numpy array for a single NFT colelction.

Reads images from base_dir/<collection_id>/resized and saves np arryas to
base_dir/<collection_id>/numpy/pixels.npz
base_dir/<collection_id>/numpy/labels.npz
base_dir/<collection_id>/numpy/ids.npz

1) Converts images to numpy arrays
2) Creates labels for them based on ground_truth rarityScore
3) Saves results as np arrays

example run:
python3 pixelscore_service/within_collection_score/img_to_numpy.py
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

from tensorflow.keras.applications.efficientnet import preprocess_input, decode_predictions
from keras import backend as K
from numpy import savez_compressed

# Global constants, don't touch them.
# Default classes in pre-trained EfficientNet.
N_CLASSES_STANDARD_MODEL = 1000
# Classes to break down continuous ground truth rarityScore.
GROUND_TRUTH_N_CLASSES = 10
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
    'Local base directory containing images, resized, metadata, etc.')
flags.DEFINE_boolean(
    'use_checkpoint',
    False,
    'Whether to use model checkpoint transfer learned for the given collection. If False, base EfficientNet with imagenet weights is used.')


def load_labels(base_dir, collection_id, ids):
    """Loads labels based on ground-truth rarity.score for a specific nft collection.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
    Returns:
      y_train: np array with labels for  entire collection e.g. [collection_length]
    """
    # Load metadata with ground truth rarity scores.
    path = base_dir + '/{}'.format(collection_id) + '/metadata'
    filename = path + '/metadata.csv'
    df = pd.read_csv(filename, header=None, low_memory=False)
    df.columns = ['id', 'rarityScore', 'rarityRank', 'url']
    df.drop(df[df.rarityScore == 'undefined'].index, inplace=True)
    df = df.astype({"rarityScore": float})
    df['rarity_bin'] = pd.qcut(
        df['rarityScore'],
        GROUND_TRUTH_N_CLASSES,
        duplicates='drop',
        labels=np.arange(GROUND_TRUTH_N_CLASSES))
    print(df.head())
    y_train = []
    # Match labels by ids.
    # TODO(dstorcheus): double check that ids are correctly matching.
    # Name of the image corresponds to id row in metadata base.
    print(ids)
    for this_id in ids:
        df_select = df.loc[df['id'] == int(this_id)]
        print(df_select)
        if (len(df_select.index) > 1):
            print('Error: non-unique matching index for labelling.')
        else:
            this_label = df_select['rarity_bin'].values[0]
            print('This label. {}'.format(this_label))
        y_train.append(this_label)
    return np.array(y_train)


def save_pixels_numpy(base_dir, collection_id, X_train, ids):
    """Saves nft collection pixels as archived numpy array.

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

    # Save pixels.
    filename = path + '/pixels.npz'
    savez_compressed('pixels.npz', X_train)
    print('Saving pixels as numpy to {}'.format(filename))
    os.system('sudo mv pixels.npz {}'.format(filename))

    # Save ids.
    filename = path + '/ids.npz'
    savez_compressed('ids.npz', ids)
    print('Saving ids as numpy to {}'.format(filename))
    os.system('sudo mv ids.npz {}'.format(filename))
    return True


def save_labels_numpy(base_dir, collection_id, y_train, ids):
    """Saves nft collection pixels as archived numpy array.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      y_train: np array with integer labels e.g. [collection_length]
      ids: np array with local nft ids for the given collection e.g. [collection_length]
    Returns:
      True if collection was saved as numpy.
    """
    path = base_dir + '/{}'.format(collection_id) + '/numpy'
    if not os.path.exists(path):
        os.system('sudo mkdir {}'.format(path))
    filename = path + '/labels.npz'
    savez_compressed('labels.npz', y_train)
    print('Saving pixels as numpy to {}'.format(filename))
    os.system('sudo mv labels.npz {}'.format(filename))
    return True


def img_to_array(img_path):
    """Opens image from path and converts to np array."""
    print('Loading image from {}'.format(img_path))
    img = Image.open(img_path)
    img = img.convert('RGB')
    img_array = np.array(img)
    print(img_array.shape)
    del img
    gc.collect()
    return img_array


def collection_to_array(base_dir, collection_id):
    """Converts full colelction of images to np array.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'

    Returns:
      X_train: np array with flattened pixels form entire collection e.g. [collection_length, 224 * 224]
      ids: np array with local nft ids for the given collection e.g. [collection_length]
    """
    collection_folder = base_dir + '/{}'.format(collection_id) + '/resized'
    output_array = []
    ids = []
    count = 0
    for f in os.listdir(collection_folder):
        path = collection_folder + '/{}'.format(f)
        try:
            image_array = img_to_array(path)
            output_array.append(image_array)
            ids.append(f)
            print(len(output_array))
        except BaseException:
            print('Unable to load image from: {}, skipping'.format(path))
        count += 1
        if count > MAX_EXAMPLES:
            break
    X_train = np.array(output_array)
    print('Converted colelction of images to np array of shape '.format(X_train.shape))
    return X_train, ids


def main(argv):
    if FLAGS.collection_id is not None:
        print('Generating Scres for collection {}'.format(FLAGS.collection_id))
    X_train, ids = collection_to_array(
        FLAGS.base_dir, FLAGS.collection_id)
    save_pixels_numpy(FLAGS.base_dir, FLAGS.collection_id, X_train, ids)
    print('Converted images to numpy for collection {}'.format(
        FLAGS.collection_id))
    y_train = load_labels(FLAGS.base_dir, FLAGS.collection_id, ids)
    save_labels_numpy(FLAGS.base_dir, FLAGS.collection_id, y_train, ids)
    print('Saved labels for collection {}'.format(
        FLAGS.collection_id))
    print('Success')


if __name__ == '__main__':
    app.run(main)
