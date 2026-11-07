// Source-style deterministic table generator, independently checked against
// native CS2 AK/M4 angular-velocity observations. Values are degrees and
// degrees/second in Source coordinates; no camera/ray integration occurs here.
// Evidence and version limits: docs/cs2-ballistics-calibration-2026-11-07.md.
const f=Math.fround,IM=2147483647,IA=16807,IQ=127773,IR=2836,NTAB=32,NDIV=1+Math.trunc((IM-1)/NTAB);
export class CS2UniformRandomStream{
 constructor(seed=0){this.setSeed(seed);}
 setSeed(seed){if(!Number.isInteger(seed)||seed< -2147483647||seed>2147483647)throw RangeError('signed seed');this.idum=seed<0?seed:-seed;this.iy=0;this.iv=new Int32Array(NTAB);}
 nextInt(){let k,j;
  if(this.idum<=0||this.iy===0){this.idum=Math.max(1,-this.idum);for(j=NTAB+7;j>=0;j--){k=Math.trunc(this.idum/IQ);this.idum=IA*(this.idum-k*IQ)-IR*k;if(this.idum<0)this.idum+=IM;if(j<NTAB)this.iv[j]=this.idum;}this.iy=this.iv[0];}
  k=Math.trunc(this.idum/IQ);this.idum=IA*(this.idum-k*IQ)-IR*k;if(this.idum<0)this.idum+=IM;j=Math.trunc(this.iy/NDIV);this.iy=this.iv[j];this.iv[j]=this.idum;return this.iy;
 }
 randomFloat(low=0,high=1){let x=f(this.nextInt()/IM);if(x>1-1.2e-7)x=f(1-1.2e-7);return f(f(x*f(high-low))+low);}
}
export function createCS2RecoilTable({seed,angle=0,angleVariance=0,magnitude,magnitudeVariance=0,automatic=true,count=64,suppressionShots=4,suppressionFactor=.75,smoothing=.55}){
 if(!Number.isInteger(count)||count<1||count>64||![angle,angleVariance,magnitude,magnitudeVariance,suppressionShots,suppressionFactor,smoothing].every(Number.isFinite))throw Error('Invalid recoil table coefficients');
 const round=f,rng=new CS2UniformRandomStream(seed),table=[];let a=0,m=0;
 for(let i=0;i<count;i++){
  const rawAngle=round(angle+rng.randomFloat(-angleVariance,angleVariance)),rawMagnitude=round(magnitude+rng.randomFloat(-magnitudeVariance,magnitudeVariance));
  if(automatic&&i>0){a=round(a+round(round(rawAngle-a)*smoothing));m=round(m+round(round(rawMagnitude-m)*smoothing));}else{a=rawAngle;m=rawMagnitude;}
  const suppression=automatic&&i<suppressionShots?round(suppressionFactor+(1-suppressionFactor)*i/suppressionShots):1;m=round(m*suppression);
  const radians=round(a*round(Math.PI/180)),cos=round(Math.cos(radians)),sin=round(Math.sin(radians));
  table.push(Object.freeze({index:i,rawAngle,rawMagnitude,angle:a,magnitude:m,suppression,impulse:Object.freeze([round(-cos*m),round(-sin*m),0])}));
 }
 return Object.freeze(table);
}
