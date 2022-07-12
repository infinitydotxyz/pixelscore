import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DATA_DIR = '/mnt/disks/additional-disk/data';
const METADATA_FILE_NAME = 'metadata.csv';

let count = 0;
function main() {
  console.log('Cleaning metadata files...');
  getDirs(DATA_DIR);
  console.log('Cleaned', count, 'metadata files');
}

function getDirs(dirPath: string) {
  const dirs = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isDirectory());
  const files = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isFile());
  // recurse into subdirs
  dirs.forEach((dir) => {
    getDirs(path.join(dirPath, dir));
  });

  files.forEach((file) => {
    if (file.includes(METADATA_FILE_NAME)) {
      execSync('rm ' + path.join(dirPath, file));
      console.log('Deleted', path.join(dirPath, file));
      count++;
    }
  });
}

main();
