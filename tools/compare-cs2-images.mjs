// Chrome PNG screenshots only; stdlib decoding, no new image dependencies.
import {readFile} from 'node:fs/promises';import {inflateSync} from 'node:zlib';
function decode(b){let at=8,w,h,channels;const chunks=[];
 while(at<b.length){const size=b.readUInt32BE(at),type=b.toString('ascii',at+4,at+8),data=b.subarray(at+8,at+8+size);if(type==='IHDR'){w=data.readUInt32BE(0);h=data.readUInt32BE(4);if(data[8]!==8||![2,6].includes(data[9])||data[12]!==0)throw Error('Expected noninterlaced RGB(A)8 PNG');channels=data[9]===2?3:4;}if(type==='IDAT')chunks.push(data);at+=size+12;}
 const raw=inflateSync(Buffer.concat(chunks)),stride=w*channels,pixels=Buffer.alloc(h*stride);let cursor=0;
 for(let y=0;y<h;y++){const filter=raw[cursor++];for(let x=0;x<stride;x++){const a=x>=channels?pixels[y*stride+x-channels]:0,c=y&&x>=channels?pixels[(y-1)*stride+x-channels]:0,up=y?pixels[(y-1)*stride+x]:0;let prediction=0;
   if(filter===1)prediction=a;else if(filter===2)prediction=up;else if(filter===3)prediction=(a+up)>>>1;else if(filter===4){const p=a+up-c,pa=Math.abs(p-a),pb=Math.abs(p-up),pc=Math.abs(p-c);prediction=pa<=pb&&pa<=pc?a:pb<=pc?up:c;}else if(filter!==0)throw Error('Unknown PNG filter');pixels[y*stride+x]=(raw[cursor++]+prediction)&255;
  }}return{w,h,channels,pixels};
}
const [first,second]=process.argv.slice(2);if(!first||!second)throw Error('Usage: node tools/compare-cs2-images.mjs first.png second.png');
const [a,b]=await Promise.all([first,second].map(async p=>decode(await readFile(p))));if(a.w!==b.w||a.h!==b.h)throw Error('Image dimensions differ');let count=0,total=0,changed=0,max=0;
for(let y=0;y<a.h;y++)for(let x=360;x<a.w;x++){let difference=0;for(let c=0;c<3;c++){const delta=Math.abs(a.pixels[(y*a.w+x)*a.channels+c]-b.pixels[(y*b.w+x)*b.channels+c]);difference=Math.max(difference,delta);total+=delta;max=Math.max(max,delta);}if(difference>8)changed++;count++;}
console.log(JSON.stringify({width:a.w,height:a.h,comparedPixels:count,meanAbsoluteChannelDifference:total/(count*3),pixelsOver8:changed,fractionOver8:changed/count,maxChannelDifference:max,excluded:'left 360px diagnostic HUD'}));
