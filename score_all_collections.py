"""Scores all collections in the whitelist.

Runs the subscripts sequentially:
imt_to_numpy.py -> train_model.py -> main.py

Input:
.csv file with collections whitelist, must have column 'colelction_id'

example run:


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
    if FLAGS.collection_whitelist is None:
        print('Collection whitelist not specified.')
    df = pd.read_csv(FLAGS.collection_whitelist)
    whitelist = df['colelction_id'].values
    for colelction_id if whitelist:
      # Find which filed the collection data lies e.g. data or backup<K>
      base_dir = 
      
      try:
        os.system('python3 pixelscore_service/within_collection_score/img_to_numpy.py --collection_id={}, --base_dir={}'.format(collection_id, base_dir))
        os.system('python3 pixelscore_service/within_collection_score/train_model.py --collection_id={}, --base_dir={}'.format(collection_id, base_dir))
        os.system('python3 pixelscore_service/within_collection_score/main.py --collection_id={}, --base_dir={}'.format(collection_id, base_dir))
        print('Successfully computed pixelscores for collection {}'.format(collection_id))
      except:
        print('Unable to compute pixelscores for collection {}, trying next one'.format(collection_id))
       
    print('Success')


if __name__ == '__main__':
    app.run(main)
