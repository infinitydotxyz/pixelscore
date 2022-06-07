import path from 'path';
import { appendFileSync, readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';

const DATA_DIR = '/mnt/disks/additional-disk/data';
const METADATA_DIR = 'metadata';
const METADATA_FILE = 'metadata.csv';
const IMAGES_DIR = 'resized';
const DUMMY_RARITY = '-123';

function main() {
  console.log('Creating metadata files...');
  createMetadataFiles(DATA_DIR);
}

function createMetadataFiles(dirPath: string) {
  const dirs = readdirSync(dirPath).filter((file) => statSync(path.join(dirPath, file)).isDirectory());
  dirs.forEach((dir) => {
    if (dir.startsWith('0x')) {
      // console.log(`Working ${dir}...`);
      const metadataDir = path.join(dirPath, dir, METADATA_DIR);
      const resizedImagesDir = path.join(dirPath, dir, IMAGES_DIR);
      // read .url files from resized dir
      const urlFiles = readdirSync(resizedImagesDir).filter(
        (file) => statSync(path.join(resizedImagesDir, file)).isFile() && file.endsWith('.url')
      );
      const metadataFile = path.join(metadataDir, METADATA_FILE);
      if (urlFiles.length > 0) {
        // recreate metadata file
        execSync(`rm ${metadataFile}`);
        execSync(`touch ${metadataFile}`);
      }
      for (const urlFile of urlFiles) {
        const imageFileName = urlFile.replace('.url', '');
        const imageFile = path.join(resizedImagesDir, imageFileName);
        if (existsSync(imageFile)) {
          const [tokenId, imageUrl] = readFileSync(path.join(resizedImagesDir, urlFile), 'utf8').split(',');
          appendFileSync(metadataFile, `${tokenId},${DUMMY_RARITY},${DUMMY_RARITY},${imageUrl}\n`);
        } else {
          console.error('Missing image:', imageFile);
        }
      }
    }
  });
}

main();
