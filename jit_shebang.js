const fs = require('fs/promises');

(async () => {
  const filePath = './dist/jit.js';
  const shebang = '#!/usr/bin/env node\n';

  try {
    // Read the original content of the file
    let content = await fs.readFile(filePath, 'utf-8');

    // Add the shebang line at the beginning
    if (!content.startsWith(shebang)) {
      content = shebang + content;
      await fs.writeFile(filePath, content);
      console.log('Shebang line added successfully to jit.js');
    } else {
      console.log('Shebang line already exists in jit.js');
    }
  } catch (error) {
    console.error('Error processing jit.js:', error);
  }
})();
