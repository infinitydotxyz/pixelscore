#! /bin/bash

# USAGE: ./bog.sh <chainId> <collectionAddress>
# e.g: ./bog.sh 1 0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d

# this script:
# 0. Needs chainId and collection address as args
# 1. Copies images from gcs to local filesystem
# 2. Resizes them using imagemagick's mogrify to 224x224 (separate folder)
#       by maintaining the aspect ratio and crops so there’s nothing overlapping

display_usage() { 
    echo -e "\nUsage: ./bog.sh <chainId> <collectionAddress> \n" 
}

# if less than two arguments supplied, display usage 
if [  $# -le 1 ] 
then 
    display_usage
    exit 1
fi 

# read args
chainId=$1
collectionAddress=$2

# cd to the right dir
cd /mnt/disks/ssd/data

# mkdirs
echo "======================================== Creating dirs ==================================================="
mkdir -p $collectionAddress/orig
mkdir -p $collectionAddress/resized

# copy files from gcs (multi-threaded) into <collectionAddress>/orig dir
echo "======================================== Copying files from gcs ==================================================="
gsutil -m cp gs://infinity-static/images/$chainId/collections/$collectionAddress/* $collectionAddress/orig

# resize and save to resized folder
echo "======================================== Resizing with mogrify ==================================================="
mogrify -verbose -path $collectionAddress/resized -resize 224x224^ -gravity center -extent 224x224 $collectionAddress/orig/*

