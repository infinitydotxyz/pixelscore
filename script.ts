import fs from 'fs';
import path from 'path';
import { createWriteStream, mkdirSync } from 'fs';
import { execSync, exec } from 'child_process';

const DATA_DIR = 'data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';
const IMAGES_DIR = 'resized';
const DUMMY_RARITY = '-123';

function main() {
  console.log('Creating metadata files...');
  createMetadataFiles(path.join(__dirname, DATA_DIR));
}

function createMetadataFiles(dirPath: string) {
  const dirs = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isDirectory());
  dirs.forEach((dir) => {
    if (dir.startsWith('0x')) {
      // console.log(`Working ${dir}...`);
      const metadataDir = path.join(dirPath, dir, METADATA_DIR);
      const resizedImagesDir = path.join(dirPath, dir, IMAGES_DIR);
      // if (!fs.existsSync(metadataDir)) {
      // console.log(`Metadata dir does not exist. Creating it...`);
      // create metadata dir
      // mkdirSync(metadataDir, { recursive: true });
      // create metadata file
      // fs.closeSync(fs.openSync(metadataFile, 'w'));

      // read .url files from resized dir
      const urlFiles = fs
        .readdirSync(resizedImagesDir)
        .filter((file) => fs.statSync(path.join(resizedImagesDir, file)).isFile() && file.endsWith('.url'));
      const metadataFile = path.join(metadataDir, METADATA_FILE);
      if (urlFiles.length > 0) {
        // recreate metadata file
        execSync(`rm ${metadataFile}`);
        execSync(`touch ${metadataFile}`);
      }
      for (const urlFile of urlFiles) {
        const imageFileName = urlFile.replace('.url', '');
        const imageFile = path.join(resizedImagesDir, imageFileName);
        if (fs.existsSync(imageFile)) {
          const [tokenId, imageUrl] = fs.readFileSync(path.join(resizedImagesDir, urlFile), 'utf8').split(',');
          fs.appendFileSync(metadataFile, `${tokenId},${DUMMY_RARITY},${DUMMY_RARITY},${imageUrl}\n`);
        } else {
          console.error('Missing image:', imageFile);
        }
      }
      // }
    }
  });
}

main();
