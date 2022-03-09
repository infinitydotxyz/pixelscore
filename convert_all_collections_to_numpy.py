"""Converts all colelctions in the folder to numpy

Runs the subscripts
img_to_numpy.py for all available collections

"""
import os
import gc
import sys
import numpy as np
from PIL import Image
from absl import app
from absl import flags
import pandas as pd

FLAGS = flags.FLAGS

flags.DEFINE_string(
    'collection_whitelist',
    '',
    'Path to .csv file with whitelist of collection_id')
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

def main(argv):
    base_dir = FLAGS.base_dir
    whitelist = os.listdir(base_dir)
    for collection_id in whitelist:
      try:
        os.system('python3 pixelscore_service/within_collection_score/img_to_numpy.py --collection_id={} --base_dir={}'.format(collection_id, base_dir))
        print('Successfully computed pixelscores for collection {}'.format(collection_id))
      except:
        print('Unable to compute pixelscores for collection {}, trying next one'.format(collection_id))
       
    print('Success')


if __name__ == '__main__':
    app.run(main)
