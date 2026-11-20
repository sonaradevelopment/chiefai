import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for (const name of ['index.html','app.js','style.css','glow.css']) await copyFile(name,`dist/${name}`);
await copyFile('_routes.json','dist/_routes.json');
