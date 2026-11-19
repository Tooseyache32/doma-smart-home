import 'dotenv/config';
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const app=createApp();
const dist=resolve(root,'dist');
if(process.env.NODE_ENV==='production'&&existsSync(resolve(dist,'index.html'))) {
  app.use(express.static(dist,{index:false,maxAge:'1h'}));
  app.get('/{*path}',(req,res,next)=> {
    if(req.path.startsWith('/api/')) return next();
    res.set('Cache-Control','no-cache').sendFile(resolve(dist,'index.html'));
  });
}
app.use((_req,res)=>res.status(404).json({error:'Маршрут не найден'}));
const port=Number(process.env.PORT??3001);
if(!Number.isInteger(port)||port<1||port>65535) {app.locals.close();throw new Error('PORT must be an integer between 1 and 65535');}
const server=app.listen(port,()=>console.log(`Doma API listening on http://localhost:${port}`));
server.on('error',(error)=> {app.locals.close();console.error(error);process.exitCode=1;});
const shutdown=()=>server.close(()=> {app.locals.close();process.exit(0);});
process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
