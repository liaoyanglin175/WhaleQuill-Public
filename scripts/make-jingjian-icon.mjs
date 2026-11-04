// Compose the existing transparent logo in a neutral vector app-icon container.
import {readFile,writeFile} from 'node:fs/promises';
const logo=(await readFile('public/brand/jingjian-transparent.png')).toString('base64');
await writeFile('public/brand/jingjian-app-icon.svg',`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" viewBox="0 0 512 512"><rect x="8" y="8" width="496" height="496" rx="104" fill="#f7f7f8"/><image x="48" y="150" width="416" height="208" xlink:href="data:image/png;base64,${logo}"/></svg>\n`);
