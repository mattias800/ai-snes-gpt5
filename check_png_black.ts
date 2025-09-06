import * as fs from 'fs';
import { PNG } from 'pngjs';

const files = ['cputest-full-1sec.png', 'cputest-full-10sec.png'];

for (const filename of files) {
  const data = fs.readFileSync(filename);
  const png = PNG.sync.read(data);
  
  let allBlack = true;
  let nonBlackPixels = 0;
  const uniqueColors = new Set<string>();
  
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    
    const color = `${r},${g},${b},${a}`;
    uniqueColors.add(color);
    
    if (r !== 0 || g !== 0 || b !== 0) {
      allBlack = false;
      nonBlackPixels++;
    }
  }
  
  const totalPixels = png.data.length / 4;
  console.log(`\n${filename}:`);
  console.log(`  Size: ${png.width}x${png.height}`);
  console.log(`  All black: ${allBlack}`);
  console.log(`  Non-black pixels: ${nonBlackPixels}/${totalPixels} (${(nonBlackPixels/totalPixels*100).toFixed(2)}%)`);
  console.log(`  Unique colors: ${uniqueColors.size}`);
  
  if (uniqueColors.size <= 10) {
    console.log('  Colors:');
    uniqueColors.forEach(color => {
      console.log(`    ${color}`);
    });
  }
}
