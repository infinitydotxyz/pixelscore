"""Train DNN model for particular collection.

EfficientNet used for rarity scoring is initialized from imagenet and fine-tuned
on the givel collection with ground-truth raritySroce provided by Mavriklabs
exchange.

Loads training data and labels from
base_dir/<collection_id>/numpy/pixels.npz
base_dir/<collection_id>/numpy/labels.npz

Saves trained model checkpoint as Keras model to
base_dir/<collection_id>/tf_logs/model

Writes intermediate training data into tf_logs as well.

example run:
python3 pixelscore_service/within_collection_score/train_model.py
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
from keras.models import Sequential
from keras.layers.core import Dense, Dropout, Activation, Flatten
from keras.layers import GlobalAveragePooling2D
from tensorflow.keras.applications.efficientnet import preprocess_input, decode_predictions
from keras import backend as K
from numpy import savez_compressed

# Functions for loading model and scoring one collection of NFTs.

N_CLASSES = 10
# Num classes to binarize ground truth rarity score.
GROUND_TRUTH_N_CLASSES = 10
# Default classes in pre-trained EfficientNet.
N_CLASSES_STANDARD_MODEL = 1000
# Read only MAX_EXAMPLES from collection, set to 100K to read everything.
MAX_EXAMPLES = 100000
# Image dimension for EfficientNet.
EFFICIENTNET_IMAGE_SIZE = 224
# Number of bins for pixel rarity score, must be less than collection size.
PIXEL_SCORE_BINS = 10
# Params for fine tuning EfficientNet on groundtruth rarityScore.
EPOCHS = 10
BATCH_SIZE = 32
LR = 0.001

FLAGS = flags.FLAGS
flags.DEFINE_string(
    'collection_id',
    '0x9a534628b4062e123ce7ee2222ec20b86e16ca8f',
    'Collection id.')
flags.DEFINE_string(
    'base_dir',
    '/mnt/disks/ssd/data',
    'Local base directory containing images.')
flags.DEFINE_string(
    'checkpoints_dir',
    '/mnt/disks/ssd/checkpoints',
    'Local dire where model checkpoints for each collection are stored.')
flags.DEFINE_boolean(
    'use_checkpoint',
    False,
    'Whether to use model checkpoint transfer learned for the given collection. If False, base EfficientNet with imagenet weights is used.')

def tensorboard_callback(directory, name):
    """Tensorboard Callback."""
    log_dir = directory + "/" + name
    t_c = tf.keras.callbacks.TensorBoard(log_dir=log_dir)
    return t_c


def model_checkpoint(directory, name):
    """Model checkpoint callback."""
    log_dir = directory + "/" + name
    m_c = tf.keras.callbacks.ModelCheckpoint(filepath=log_dir,
                                             monitor="val_accuracy",
                                             save_best_only=True,
                                             save_weights_only=True,
                                             verbose=1)
    return m_c


def load_collection_numpy(base_dir, collection_id):
    """Loads nft collection pixels as archived numpy array.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
    Returns:
      X_train: np array with flattened pixels form entire collection e.g. [collection_length, 224 * 224]
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


def load_labels(base_dir, collection_id, ids):
    """Loads labels based on ground-truth rarity.score for a specific nft collection.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
    Returns:
      y_train: np array with labels for  entire collection e.g. [collection_length]
    """
    # Load labels.
    path = base_dir + '/{}'.format(collection_id) + '/numpy'
    filename = path + '/labels.npz'
    y_train = np.load(filename)['arr_0']
    print('Loading labels as numpy from {}'.format(filename))
    return y_train


def save_collection_scores(base_dir, collection_id, df):
    """Saves pixel scores for the given collection in .csv.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      df: dataframe with columns at least 'id' and 'PixelScore'

    Returns:
      True if collection was saved as numpy.
    """
    path = base_dir + '/{}'.format(collection_id) + '/pixelscore'
    if not os.path.exists(path):
        os.system('sudo mkdir {}'.format(path))
    filename = path + '/pixelscore.csv'
    df.to_csv('pixelscore.csv')
    print('Saving layers as numpy to {}'.format(filename))
    os.system('sudo mv pixelscore.csv {}'.format(filename))
    return True


def load_standard_model():
    """Loads pretrained EfficinetNet."""
    base_model = tf.keras.applications.EfficientNetB0(
        include_top=False,
        input_shape=(
            EFFICIENTNET_IMAGE_SIZE,
            EFFICIENTNET_IMAGE_SIZE,
            3),
        weights="imagenet",
        classes=N_CLASSES_STANDARD_MODEL)
    return base_model


def create_architecture_small_cnn():
    """Small cnn from scratch.."""
    model = Sequential()
    model.add(
        keras.layers.Conv2D(
            32, (3, 3), activation='relu', input_shape=(
                EFFICIENTNET_IMAGE_SIZE, EFFICIENTNET_IMAGE_SIZE, 3)))
    model.add(keras.layers.MaxPooling2D((2, 2)))
    model.add(keras.layers.Conv2D(32, (3, 3), activation='relu'))
    model.add(keras.layers.MaxPooling2D((2, 2)))
    model.add(keras.layers.Conv2D(32, (3, 3), activation='relu'))
    model.add(keras.layers.Flatten())
    model.add(keras.layers.Dropout(0.3))
    model.add(keras.layers.Dense(32, activation='relu'))
    model.add(keras.layers.Dense(N_CLASSES, activation=('softmax')))
    model.summary()
    return model


def create_architecture_regression():
    """Regression from scratch.."""
    model = Sequential()
    model.add(
        keras.layers.Dense(
            28,
            activation='relu',
            input_shape=(
                EFFICIENTNET_IMAGE_SIZE,
                EFFICIENTNET_IMAGE_SIZE,
                3)))
    model.add(keras.layers.Flatten())
    model.add(keras.layers.Dropout(0.3))
    model.add(keras.layers.Dense(32, activation='relu'))
    model.add(keras.layers.Dense(N_CLASSES, activation=('softmax')))
    model.summary()
    return model


def create_architecture():
    """Fine tuning on top of Efficient init from imagenet.

    Recommended lr = TBD
    ok to train on CPU for 10 epochs takes 1h.
    """
    base_model = tf.keras.applications.EfficientNetB0(
        include_top=False,
        input_shape=(
            EFFICIENTNET_IMAGE_SIZE,
            EFFICIENTNET_IMAGE_SIZE,
            3),
        weights="imagenet",
        classes=N_CLASSES_STANDARD_MODEL)
    base_model.trainable = False
    # Now trainable layers.
    model = Sequential()
    model.add(base_model)
    model.add(GlobalAveragePooling2D())
    # model.add(Dense(128,activation=('relu')))
    # model.add(Dense(N_CLASSES,activation=('softmax')))
    model.add(Flatten())
    model.add(Dense(1024, activation=('relu'), input_dim=512))
    model.add(Dense(512, activation=('relu')))
    model.add(Dense(256, activation=('relu')))
    # model.add(Dropout(.3))
    model.add(Dense(128, activation=('relu')))
    # model.add(Dropout(.2))
    model.add(Dense(N_CLASSES, activation=('softmax')))
    # Model summary
    print(model.summary())
    return model

def train_model(base_dir, collection_id, model, X_train, y_train):
    """Fine tunes EfficientNet on a given collection with ground truth labels.

    Saves model checkpoint to base_dir/<collection_id>/tf_logs/model.

    Args:
      base_dir: Base data directory on the current vm e.g. /mnt/disks/ssd/data
      collection_id: collection address e.g. '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'
      model: Keras model
      X_train: np array with flattened pixels for entire collection e.g. [collection_length, 224 * 224]
      y_train: ground truth labels for entire collection e.g. [collection_length]

    Returns:
      model: trained Keras model
    """
    tf_logs = base_dir + '/{}'.format(collection_id) + '/tf_logs'
    if not os.path.exists(tf_logs):
        os.system('sudo mkdir {}'.format(tf_logs))
    os.system('sudo chmod -R ugo+rwx {}'.format(tf_logs))
    # Compile model.
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LR),
        loss=tf.keras.losses.CategoricalCrossentropy(),
        metrics=['accuracy'])
    steps_per_epoch = len(y_train) // BATCH_SIZE
    validation_steps = len(y_train) // BATCH_SIZE
    callbacks_ = [tensorboard_callback(tf_logs, "model"),
                  model_checkpoint(tf_logs, "model.ckpt")]
    # Train model.
    hist = model.fit(
        x=X_train, y=y_train,
        epochs=EPOCHS, steps_per_epoch=steps_per_epoch,
        validation_data=(X_train, y_train), callbacks=callbacks_).history
    model.save(tf_logs + '/model')
    return model


def main(argv):
    if FLAGS.collection_id is not None:
        print('Training model for collection {}'.format(FLAGS.collection_id))
    model = create_architecture()
    X_train, ids = load_collection_numpy(FLAGS.base_dir, FLAGS.collection_id)
    y_train = load_labels(FLAGS.base_dir, FLAGS.collection_id, ids)
    y_train_cat = tf.keras.utils.to_categorical(y_train)
    trained_model = train_model(
        FLAGS.base_dir,
        FLAGS.collection_id,
        model,
        X_train,
        y_train_cat)
    print(
        'Completed model training for collection {}'.format(
            FLAGS.collection_id))
    print('Success')


if __name__ == '__main__':
    app.run(main)
