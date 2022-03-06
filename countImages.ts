import fs from 'fs';
import path from 'path';
const DATA_DIR = 'data';

let count = 0;
function main() {
  console.log('Counting images...');
  getDirs(path.join(__dirname, DATA_DIR));
  console.log('Found', count, 'images');
}

function getDirs(dirPath: string) {
  const dirs = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isDirectory());
  const files = fs.readdirSync(dirPath).filter((file) => fs.statSync(path.join(dirPath, file)).isFile());
  // recurse into subdirs
  dirs.forEach((dir) => {
    getDirs(path.join(dirPath, dir));
  });

  files.forEach((file) => {
    count++;
  });
}

main();
