import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceThumbnailCells} from '../editor/source-thumbnail-cells.mjs';

const thumbnails=[0,10,20,30].map(time=>({time,url:`thumb-${time}.jpg`}));
test('thumbnail cells stay evenly spaced across sample boundaries',()=>{
 const cells=sourceThumbnailCells({thumbnails,start:0,duration:40,width:350,cellWidth:80});
 assert.deepEqual(cells.map(c=>c.left),[0,80,160,240,320]);
 assert.ok(cells.every(c=>c.width===80));
 assert.deepEqual(cells.map(c=>c.url),['thumb-0.jpg','thumb-10.jpg','thumb-20.jpg','thumb-30.jpg','thumb-30.jpg']);
});
test('trimmed and split clips sample their source in-point',()=>{
 const cells=sourceThumbnailCells({thumbnails,start:20,duration:10,width:160,cellWidth:80});
 assert.deepEqual(cells.map(c=>c.url),['thumb-20.jpg','thumb-20.jpg']);
 const partial=sourceThumbnailCells({thumbnails,start:0,duration:20,width:170,cellWidth:80});
 assert.equal(partial.at(-1).url,'thumb-10.jpg');
});
test('extreme zoom stays bounded, and empty geometry is safe',()=>{
 const cells=sourceThumbnailCells({thumbnails,start:0,duration:40,width:1000000});
 assert.equal(cells.length,512);
 assert.equal(cells.at(-1).left+cells.at(-1).width,1000000);
 assert.deepEqual(sourceThumbnailCells({thumbnails:[],start:0,duration:40,width:160}),[]);
 assert.deepEqual(sourceThumbnailCells({thumbnails,start:0,duration:0,width:160}),[]);
});
