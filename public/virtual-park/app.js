import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initBridge } from './bridge.js';
import { makeRand, noise2, grassTexture, pathTexture, waterTexture, fallTexture, buildSky, makePlants, makeTufts, buildHills, buildMist, makeFlowers, makeReeds, Scatter } from './scenery.js';
import { loadPhotoTextures } from './photo.js';
import { buildGazebo, lampGeos, buildBench } from './props.js';

// Park Discovery 3K, adapted for ProForm Smart Control.
// EMBED = running inside the app: the app owns time, distance, pace and all
// controls, and this page only draws the park at the position it is given.
const EMBED = window.parent !== window;

// Stand-alone visual simulator. It NEVER sends BLE writes or controls a treadmill.
// An embedding host can emit CustomEvent('proform:telemetry', {detail:{speedKmh:5, verified:true}})
// after it has independently decoded and verified live speed data.
const $ = id => document.getElementById(id);
const ui = {
  time:$('time'),distance:$('distance'),speed:$('speed'),calories:$('calories'),controlSpeed:$('controlSpeed'),
  slider:$('paceSlider'),progress:$('progressFill'),percent:$('routePercent'),landmark:$('landmark'),
  map:$('mapCanvas'),source:$('sourcePill'),loading:$('loading'),loadTitle:$('loadTitle'),loadDesc:$('loadDesc')
};
const state={pace:5, manualPace:5, playing:!EMBED, mode:'demo', liveLast:0, meters:0, seconds:0, view:'third', previewOffset:0,frame:0};
const FULL=3000;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let waterTime=0,frameCount=0,fpsFrames=0,fpsSince=performance.now(),fpsNow=0;
const bell=(u,c,w)=>{let d=Math.abs(u-c);d=Math.min(d,1-d);return Math.exp(-Math.pow(d/w,4));};
const scene = new THREE.Scene();
scene.background=new THREE.Color(0xcfe1e6);
scene.fog=new THREE.FogExp2(0xcfe1e6,0.0034);
const camera=new THREE.PerspectiveCamera(65,1,0.15,420);
const canvasHost=$('scene');
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance',alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.55));
  renderer.setSize(canvasHost.clientWidth,canvasHost.clientHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.02;
  canvasHost.append(renderer.domElement);
}catch(err){$('fatal').hidden=false;$('fatalReason').textContent='3D graphics could not start: '+err.message;throw err;}
// Real photo textures (Poly Haven, CC0). Any that fail to load come back empty and the painted version is used instead.
if($('loadTitle'))$('loadTitle').textContent='Loading park textures…';
const photo=await loadPhotoTextures(Math.min(renderer.capabilities.getMaxAnisotropy(),8)).catch(()=>({missing:['all'],total:0,count:0}));
if(photo.missing.length)console.info('Park photo textures not loaded:',photo.missing.join(', '));
if(photo.sky){scene.background.set(0xbecfe5);scene.fog.color.set(0xbecfe5);}
const hemi=new THREE.HemisphereLight(0xdcefff,0x5d7046,photo.env?.95:1.75);scene.add(hemi);
if(photo.env){try{
 // Light the park from the real sky picture as well as the sun.
 const pm=new THREE.PMREMGenerator(renderer);photo.env.mapping=THREE.EquirectangularReflectionMapping;
 scene.environment=pm.fromEquirectangular(photo.env).texture;scene.environmentIntensity=.75;pm.dispose();
}catch(err){console.info('Sky lighting skipped:',err&&err.message);hemi.intensity=1.75;}}
const sun=new THREE.DirectionalLight(0xffe7bd,3.7);sun.position.set(65,105,-25);sun.castShadow=true;
// Where the sun is, relative to the walker. Set properly once the route exists (low sun over the lake at the start).
const SUN=new THREE.Vector3(62,78,-48);
sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;sun.shadow.camera.far=400;sun.shadow.normalBias=0.035;sun.shadow.bias=-0.0007;scene.add(sun);scene.add(sun.target);
const mats={
 ground:new THREE.MeshStandardMaterial({color:0x63954d,roughness:1}),
 path:new THREE.MeshStandardMaterial({color:0xa9987f,roughness:1}),
 edge:new THREE.MeshStandardMaterial({color:0x8d8676,roughness:1}),
 trunk:new THREE.MeshStandardMaterial({color:0x75614a,roughness:1}),
 leaves:new THREE.MeshStandardMaterial({color:0x538752,roughness:0.9,flatShading:false,side:THREE.DoubleSide}),
 darkLeaves:new THREE.MeshStandardMaterial({color:0x355e47,roughness:0.95}),
 pine:new THREE.MeshStandardMaterial({color:0x296047,roughness:0.94,flatShading:true}),
 wood:new THREE.MeshStandardMaterial({color:0x936b45,roughness:0.9}),
 metal:new THREE.MeshStandardMaterial({color:0x4b5a56,roughness:0.55}),
 water:new THREE.MeshPhysicalMaterial({color:0x4babb6,metalness:0.04,roughness:0.25,transparent:true,opacity:0.86,side:THREE.DoubleSide}),
 foam:new THREE.MeshBasicMaterial({color:0xd1faff,transparent:true,opacity:0.62,side:THREE.DoubleSide}),
 rock:new THREE.MeshStandardMaterial({color:0x807f72,roughness:0.95,flatShading:true}),
 flower:new THREE.MeshStandardMaterial({color:0xf8a4b3,roughness:1})
};
const randSeed=124091;let seed=randSeed;
function rand(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
function r(a,b){return a+(b-a)*rand();}
function group(...obj){let g=new THREE.Group();obj.forEach(o=>g.add(o));return g;}
function mesh(geo,mat,shadows=true){const m=new THREE.Mesh(geo,mat);m.castShadow=shadows;m.receiveShadow=shadows;return m;}
function texNoise(base,amplitude=24,size=256){
  const cvs=document.createElement('canvas');cvs.width=cvs.height=size;const c=cvs.getContext('2d');
  c.fillStyle=base;c.fillRect(0,0,size,size);
  for(let i=0;i<9500;i++){
    const a=Math.floor(r(0,255));c.fillStyle=`rgba(${a},${a},${a},${r(0.018,0.075)})`;
    c.fillRect(r(0,size),r(0,size),r(0,2.7),r(.25,2.5));
  }
  let t=new THREE.CanvasTexture(cvs);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;
  t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);return t;
}
const srand=makeRand(90417);
const maxAniso=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
const grassTex=photo.grass||grassTexture(srand,maxAniso);grassTex.repeat.set(photo.grass?870:420,photo.grass?870:420);
mats.ground.map=grassTex;mats.ground.color.set(photo.grass?0xe0e8d4:0xffffff);mats.ground.vertexColors=true;mats.ground.needsUpdate=true;
const pathTex=photo.asphalt||pathTexture(srand,maxAniso);pathTex.repeat.set(photo.asphalt?3:1,photo.asphalt?6.67:1.1);
mats.path.map=pathTex;mats.path.color.set(photo.asphalt?0xd9d9d9:0xffffff);
if(photo.asphalt&&photo.asphaltN){photo.asphaltN.repeat.copy(pathTex.repeat);mats.path.normalMap=photo.asphaltN;mats.path.normalScale=new THREE.Vector2(.3,.3);mats.path.roughness=.9;}
mats.path.needsUpdate=true;
if(photo.rock){mats.rock.map=photo.rock;mats.rock.color.set(0xffffff);mats.rock.needsUpdate=true;}
const waterTex=waterTexture(srand);waterTex.repeat.set(5,5);
mats.water.map=waterTex;mats.water.color.set(0xd8f2f4);mats.water.roughness=.12;mats.water.metalness=.25;mats.water.opacity=.9;mats.water.needsUpdate=true;
// The lake: deep, glossy water that mirrors the sky, with moving ripples.
const lakeMat=new THREE.MeshStandardMaterial({color:0x1d3f47,roughness:.06,metalness:.0,envMapIntensity:1.15});
if(photo.waterN){photo.waterN.rotation=.6;lakeMat.normalMap=photo.waterN;lakeMat.normalScale=new THREE.Vector2(.16,.16);}
else{lakeMat.map=waterTex;lakeMat.color.set(0x9fd0d6);}
const fallTex=fallTexture(srand);fallTex.repeat.set(1,1.4);
const sky=buildSky(scene,srand,photo.sky);
// The ground far from the path: large patches of lighter and darker grass so it is not one flat green.
const groundGeo=new THREE.PlaneGeometry(2600,2600,60,60);
{const gp=groundGeo.attributes.position,gc=new Float32Array(gp.count*3);
 for(let i=0;i<gp.count;i++){const k=.78+.4*noise2(gp.getX(i)/55+40,gp.getY(i)/55+40);gc[i*3]=k;gc[i*3+1]=k*1.02;gc[i*3+2]=k*.94;}
 groundGeo.setAttribute('color',new THREE.BufferAttribute(gc,3));}
const ground=mesh(groundGeo,mats.ground,false);
ground.rotation.x=-Math.PI/2;ground.position.y=-0.24;ground.receiveShadow=true;scene.add(ground);

// Construct ONE continuous scenic route, about 3,000 real-world model units long.
// It is a spline through 100 points with changes in heading and elevation, not frames of a photo.
const controls=[];
for(let i=0;i<100;i++){
 const u=i/100, a=2*Math.PI*u;
 const R=470+41*Math.sin(3*a+0.4)+22*Math.cos(7*a);
 const x=Math.cos(a)*R + 22*Math.sin(5*a), z=Math.sin(a)*R*.92+17*Math.cos(4*a);
 controls.push(new THREE.Vector3(x,0,z));
}
let route=new THREE.CatmullRomCurve3(controls,true,'catmullrom',0.42);
const scale=FULL/route.getLength();controls.forEach(p=>{p.x*=scale;p.z*=scale;});
for(let i=0;i<controls.length;i++){
 let u=i/controls.length;
 controls[i].y=0.055+2.4*bell(u,.20,.016)+2.0*bell(u,.70,.016)+3.0*bell(u,.62,.075)+.45*Math.sin(u*6*Math.PI);
}
route=new THREE.CatmullRomCurve3(controls,true,'catmullrom',0.42);
const routeLength=route.getLength(); // accurate traveled distance, approximately 3000 metres
function pointAt(dist){return route.getPointAt(((dist/routeLength)%1+1)%1);}
function tangentAt(dist){return route.getTangentAt(((dist/routeLength)%1+1)%1).normalize();}
function frameAt(dist){const p=pointAt(dist),v=tangentAt(dist);const n=new THREE.Vector3(-v.z,0,v.x).normalize();return {p,v,n};}
function atFraction(f){return frameAt(f*routeLength);}
{ // The sun sits ahead and to the lake side of the first stretch, 46 degrees up, so the big trees dapple the path with shade.
 const f=frameAt(100),h=f.v.clone().multiplyScalar(.5).addScaledVector(f.n,-.84).normalize();
 SUN.set(h.x,Math.tan(46*Math.PI/180),h.z).normalize().multiplyScalar(120);
 if(sky.userData.photo){const u=.897,src=Math.atan2(Math.sin(2*Math.PI*u),-Math.cos(2*Math.PI*u)),dst=Math.atan2(SUN.z,SUN.x);sky.rotation.y=src-dst;}
}
// A strip laid along the route between two sideways offsets (offA to the left of offB). Used for kerbs, flower beds and paving.
function strip(d0,d1,step,offA,offB,yAt,material,uvAt){
 const pos=[],uv=[],idx=[],n=Math.max(1,Math.round((d1-d0)/step));
 for(let i=0;i<=n;i++){
  const dist=d0+(d1-d0)*i/n,f=frameAt(dist);
  [offA,offB].forEach((o,k)=>{const off=typeof o==='function'?o(dist):o,a=f.p.clone().addScaledVector(f.n,off);a.y=yAt(dist,off,f.p.y);pos.push(a.x,a.y,a.z);const t=uvAt(dist,off,k);uv.push(t[0],t[1]);});
  if(i<n){const q=i*2;idx.push(q,q+1,q+2,q+1,q+3,q+2);}
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
 const m=mesh(geo,material,false);m.receiveShadow=true;scene.add(m);return m;
}

function ribbon(count,width,getP,material){
 let positions=[],uv=[],indices=[];
 for(let i=0;i<=count;i++){
  let s=i/count, dist=s*routeLength, f=frameAt(dist);
  for(let sign of [-1,1]){
   let a=f.p.clone().addScaledVector(f.n,sign*width/2);a.y+=getP(s,sign);
   positions.push(a.x,a.y,a.z);uv.push(sign<0?0:1, s*routeLength/10);
  }
  if(i<count){let k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
 }
 let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
 return mesh(geo,material,false);
}
{const e=ribbon(1550,5.5,()=>-.07,mats.edge),pth=ribbon(1550,4.5,()=>-.035,mats.path);e.receiveShadow=true;pth.receiveShadow=true;scene.add(e);scene.add(pth);}

// Height of the grass at a point: `dist` along the lap, `off` metres sideways from the path centre, `py` the path height there.
const BRIDGES=[.20*routeLength,.70*routeLength];
function bankK(dist){let k=1;for(const bd of BRIDGES){const d=Math.abs(dist-bd);k=Math.min(k,clamp((d-6.5)/5.5,0,1));}return k*k*(3-2*k);}
// The lake lies along the outer (left) side of the route from 60 m before the start line to 420 m after it.
const LAKE={a:-60,b:420,fade:35,width:112},WATER_Y=-.16;
const sstep=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
const relDist=d=>{d=((d%routeLength)+routeLength)%routeLength;return d>routeLength/2?d-routeLength:d;};
function lakeK(dist){const d=relDist(dist);return sstep((d-LAKE.a)/LAKE.fade)*sstep((LAKE.b-d)/LAKE.fade);}
function groundY(dist,off,py){
 const a=Math.abs(off),top=-.23+(py-.12+.23)*bankK(dist);
 let y=a<=9.5?top:a<17?top+(-.23-top)*(a-9.5)/7.5:-.23;
 if(off<0){const k=lakeK(dist);if(k>0){const ly=a<=4.3?top:top+(-.62-top)*sstep((a-4.3)/3.9);y+=(ly-y)*k;}} // bank sloping down into the lake
 return y;
}
// Lake outline, measured from the middle of the park: at each bearing, where the water starts and how wide it is.
const lakeTable=[];
for(let d=LAKE.a;d<=LAKE.b;d+=4){const p=pointAt(d);lakeTable.push({d,th:Math.atan2(p.z,p.x),rho:Math.hypot(p.x,p.z),w:LAKE.width*Math.sqrt(lakeK(d))});}
function inLake(x,z,margin=0){
 const th=Math.atan2(z,x),T=lakeTable;if(th<T[0].th||th>T[T.length-1].th)return false;
 let i=1;while(i<T.length-1&&T[i].th<th)i++;
 const a=T[i-1],b=T[i],t=(th-a.th)/Math.max(1e-6,b.th-a.th),rho=a.rho+(b.rho-a.rho)*t,w=a.w+(b.w-a.w)*t,rr=Math.hypot(x,z);
 return w>8&&rr>rho+6-margin&&rr<rho+6.5+w+margin;
}
// The showcase stretch (first 210 m): flower beds along the right-hand kerb.
const BEDS=[[18,80],[100,150],[163,171.5],[180.5,208]];
const inBed=(dist,off)=>{const d=relDist(dist);return off>2.7&&off<6.6&&BEDS.some(b=>d>b[0]-.6&&d<b[1]+.6);};
const nearBridge=(dist,m)=>BRIDGES.some(bd=>Math.abs(dist-bd)<m);
// Added for ProForm Smart Control. Each extra is isolated so a problem in one cannot stop the park loading.
function extra(name,fn){try{fn();}catch(err){console.info('Park extra skipped:',name,err&&err.message);}}
// 1. Grass banks under the path where it climbs (bridges, hill), so the path does not float above flat ground.
extra('banks',()=>{
 const count=1550,cross=[-17,-12.5,-9.5,-8.2,-7.2,-6.4,-5.6,-4.9,-4.3,-3.3,3.3,9.5,17],C=cross.length;
 let positions=[],uv=[],colors=[],indices=[];
 for(let i=0;i<=count;i++){
  const s=i/count,dist=s*routeLength,f=frameAt(dist),k=bankK(dist);
  for(const off of cross){
   const a=f.p.clone().addScaledVector(f.n,off);
   a.y=groundY(dist,off,f.p.y)+(Math.abs(off)<3.4?.03*k:0);
   positions.push(a.x,a.y,a.z);uv.push((off+17)/5,dist/5);
   let c=.8+.36*noise2(dist/13+off/9,off/7+3);
   if(off<0&&a.y<WATER_Y+.1)c*=.5+.5*sstep((a.y-WATER_Y+.12)/.22); // darker, damp ground at the waterline
   colors.push(c,c*1.02,c*.94);
  }
  if(i<count){const q0=i*C;for(let c=0;c<C-1;c++){const q=q0+c;indices.push(q,q+1,q+C,q+1,q+C+1,q+C);}}
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
 const bankTex=grassTex.clone();bankTex.repeat.set(photo.grass?1.67:1,photo.grass?1.67:1);bankTex.needsUpdate=true;
 const bankMat=new THREE.MeshStandardMaterial({map:bankTex,roughness:1,side:THREE.DoubleSide,vertexColors:true,color:photo.grass?0xe0e8d4:0xffffff});
 const banks=mesh(geo,bankMat,false);banks.receiveShadow=true;scene.add(banks);
});
// 2. A lake beside the first and last stretch of the route (Lakeside Park, 0.0 to 0.6 km and the return).
const lakeSpots=[];
extra('lake',()=>{
 { // the long lake beside the first stretch
  const pos=[],uv=[],idx=[];
  lakeTable.forEach((t,i)=>{
   const c=Math.cos(t.th),s=Math.sin(t.th);
   for(const rr of [t.rho+5.0,t.rho+6.5+t.w]){pos.push(c*rr,WATER_Y,s*rr);uv.push(c*rr/18,s*rr/18);}
   if(i<lakeTable.length-1){const q=i*2;idx.push(q,q+2,q+1,q+1,q+2,q+3);}
  });
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
  if(geo.attributes.normal.getY(0)<0){const ix=geo.index.array;for(let i=0;i<ix.length;i+=3){const t=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=t;}geo.computeVertexNormals();}
  const lake=mesh(geo,lakeMat,false);lake.receiveShadow=true;scene.add(lake);
 }
 for(const [frac,dist,radius] of [[.94,60,40]]){
  const f=atFraction(frac),c=f.p.clone().addScaledVector(f.n,-dist);lakeSpots.push({x:c.x,z:c.z,r:radius});
  const lake=mesh(new THREE.CircleGeometry(radius,56),mats.water,false);
  lake.rotation.x=-Math.PI/2;lake.position.set(c.x,-.16,c.z);lake.receiveShadow=true;scene.add(lake);
  const shore=mesh(new THREE.CircleGeometry(radius+2.2,56),mats.edge,false);
  shore.rotation.x=-Math.PI/2;shore.position.set(c.x,-.2,c.z);scene.add(shore);
 }
});
// 3. Lampposts along the park sections.
extra('lamps',()=>{
 const geos=lampGeos();
 const iron=new THREE.MeshStandardMaterial({color:0x1b1d1f,roughness:.5,metalness:.6});
 const glow=new THREE.MeshStandardMaterial({color:0xfff3d0,emissive:0xffdf9a,emissiveIntensity:.75,roughness:.3});
 const spots=[];for(let u=.01;u<.18;u+=.018)spots.push(u);for(let u=.5;u<.58;u+=.02)spots.push(u);for(let u=.9;u<1;u+=.018)spots.push(u);
 const posts=new THREE.InstancedMesh(geos.iron,iron,spots.length),lights=new THREE.InstancedMesh(geos.glass,glow,spots.length),d=new THREE.Object3D();
 spots.forEach((u,i)=>{
  const f=atFraction(u),side=i%2?1:-1,p=f.p.clone().addScaledVector(f.n,side*3.75);
  d.position.set(p.x,f.p.y-.06,p.z);d.rotation.set(0,i*1.3,0);d.updateMatrix();posts.setMatrixAt(i,d.matrix);lights.setMatrixAt(i,d.matrix);
 });
 posts.castShadow=true;posts.frustumCulled=false;lights.frustumCulled=false;scene.add(posts);scene.add(lights);
});

// Water features and actual bridges appear at specific places along the route.
const animatedWater=[];
function makeWaterCourse(fraction){
 const {p,v,n}=atFraction(fraction);
 const g=new THREE.Group();g.position.set(p.x,-.17,p.z);
 // A winding stream crossing perpendicular to the route.
 const pts=[];for(let j=0;j<=36;j++){
  let t=(j/36-.5)*125;
  const center=p.clone().addScaledVector(n,t).addScaledVector(v,Math.sin(t*.047)*7);
  center.y=-.14;pts.push(center);
 }
 let vtx=[],index=[],suv=[];
 for(let k=0;k<pts.length;k++){
  let off=v.clone().multiplyScalar(5.7);vtx.push(...pts[k].clone().sub(off).toArray(),...pts[k].clone().add(off).toArray());suv.push(0,k*.07,.25,k*.07);
  if(k<pts.length-1){const i=k*2;index.push(i,i+2,i+1,i+1,i+2,i+3);}
 }
 let geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vtx,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(suv,2));geo.setIndex(index);geo.computeVertexNormals();
 const stream=mesh(geo,mats.water,false);stream.receiveShadow=true;scene.add(stream);
 const railY=p.y+0.65;
 for(let s of [-1,1]){
  for(let j=0;j<=8;j++){
   let d=(j-4)*1.35;
   const a=p.clone().addScaledVector(v,d).addScaledVector(n,s*2.95);
   const post=mesh(new THREE.CylinderGeometry(.09,.12,1.5,7),mats.wood);
   post.position.set(a.x,railY+.25,a.z);scene.add(post);
  }
  const rail=mesh(new THREE.BoxGeometry(.13,.13,11.2),mats.wood);
  rail.position.copy(p).addScaledVector(n,s*2.96);rail.position.y=railY+.89;rail.rotation.y=Math.atan2(v.x,v.z);scene.add(rail);
 }
 for(let i=0;i<12;i++){
  const board=mesh(new THREE.BoxGeometry(5.55,.13,.80),mats.wood);
  const f=p.clone().addScaledVector(v,(i-5.5)*.92);board.position.set(f.x,p.y-.06,f.z);board.rotation.y=Math.atan2(v.x,v.z);
  scene.add(board);
 }
}
makeWaterCourse(.20);makeWaterCourse(.70);

// A waterfall is spatially near 1.3km, cascading over a rocky outcrop into a pool.
function createWaterfall(){
 const {p,n,v}=atFraction(.44);
 const center=p.clone().addScaledVector(n,25);
 const rocks=new THREE.Group();rocks.position.copy(center);scene.add(rocks);
 const rockGeo=new THREE.DodecahedronGeometry(1,1);
 for(let i=0;i<22;i++){
  let b=mesh(rockGeo,mats.rock);b.position.set(r(-13,13),r(1,8),r(-5,6));b.scale.set(r(2,5),r(2,4),r(2,5));rocks.add(b);
 }
 const pool=mesh(new THREE.CircleGeometry(15,44),mats.water,false);pool.rotation.x=-Math.PI/2;pool.position.copy(center);pool.position.y=.045;pool.receiveShadow=true;scene.add(pool);
 const sheets=[];
 for(let i=0;i<8;i++){
  const geo=new THREE.PlaneGeometry(1.8+r(0,1.4),12,2,24);
  const mat=new THREE.MeshBasicMaterial({map:fallTex,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false,color:i%2?0xffffff:0xd9f4fb});
  const sheet=mesh(geo,mat,false);sheet.position.copy(center);sheet.position.addScaledVector(v,r(-4.5,4.5));sheet.position.y=6.1;sheet.position.addScaledVector(n,r(-2,2));
  sheet.rotation.y=Math.atan2(v.x,v.z)+r(-.18,.18);scene.add(sheet);sheets.push(sheet);
 }
 for(let j=0;j<70;j++){
  let drop=mesh(new THREE.SphereGeometry(.07,4,4),mats.foam,false);drop.position.copy(center).add(new THREE.Vector3(r(-8,8),r(.5,6),r(-6,6)));scene.add(drop);animatedWater.push({drop,origin:drop.position.clone(),speed:r(2,4)});
 }
 return sheets;
}
const fallingSheets=createWaterfall();
let mistUpdate=()=>{};
const fallSpot=(()=>{const f=atFraction(.44);const c=f.p.clone().addScaledVector(f.n,25);c.y=4;return {c,at:.44*routeLength};})();

// Vegetation is made of real 3D geometry and remains in place as the camera moves through the route.
// Trees: leafy crowns and pine boughs built from textured cards, planted in stretches along the lap
// so stretches that are far away are not drawn.
const plants=makePlants(srand,16,photo);
const nTrees=1150,dummy=new THREE.Object3D(),tintC=new THREE.Color();
const mistSpot=fallSpot.c.clone();
for(let i=0;i<nTrees;i++){
 // Nearly half the trees go into the forest stretch (1.8 to 2.76 km), closer to the path and taller.
 const inForest=rand()<.45,along=inForest?routeLength*r(.6,.92):r(0,routeLength),u=along/routeLength;
 if(nearBridge(along,10))continue; // keep the two streams clear
 const f=frameAt(along);const side=rand()<.5?-1:1;
 const d=inForest?r(7.5,48):r(11,84);const p=f.p.clone().addScaledVector(f.n,side*d);
 const baseY=groundY(along,side*d,f.p.y);
 p.addScaledVector(f.v,r(-8,8));
 if(lakeSpots.some(l=>Math.hypot(p.x-l.x,p.z-l.z)<l.r+3)||inLake(p.x,p.z,4))continue;
 if(Math.hypot(p.x-mistSpot.x,p.z-mistSpot.z)<19)continue; // not on the waterfall rocks
 {const rd=relDist(along);if(rd>-12&&rd<222&&((side>0&&d<19)||(side<0&&d<12)))continue;} // the showcase stretch is planted by hand below
 const size=inForest?r(1.3,2.9):r(.6,2.5);const isPine=rand()<(.22+.6*bell(u,.78,.13));
 const rot=r(0,Math.PI*2),shade=r(.72,1);
 if(isPine){
  const sy=size*r(.95,1.3);
  dummy.rotation.set(0,rot,0);dummy.scale.set(size,sy,size);
  dummy.position.set(p.x,baseY,p.z);dummy.updateMatrix();
  tintC.setRGB(shade,shade*1.03,shade);plants.pine.add(u,dummy.matrix,tintC);
  dummy.position.y=baseY+sy*3.5;dummy.updateMatrix();plants.pineCore.add(u,dummy.matrix);
  dummy.position.y=baseY+sy*1.0;dummy.updateMatrix();plants.pineTrunk.add(u,dummy.matrix);
 }else{
  dummy.rotation.set(0,rot,0);dummy.scale.setScalar(size);
  dummy.position.set(p.x,baseY+1.9*size,p.z);dummy.updateMatrix();plants.trunk.add(u,dummy.matrix);
  const sx=size*r(.85,1.2),sy=size*r(.85,1.25);
  dummy.position.y=baseY+5.0*size;dummy.scale.set(sx,sy,sx);dummy.updateMatrix();
  const warm=rand();tintC.setRGB(shade*(1+.1*warm),shade*1.02,shade*(1-.25*warm)); // some crowns a little yellower
  (rand()<.5?plants.crownA:plants.crownB).add(u,dummy.matrix,tintC);
  dummy.scale.set(sx*1.05,sy*1.0,sx*1.05);dummy.updateMatrix();plants.core.add(u,dummy.matrix);
 }
}
// Bushes on the grass beside the path.
for(let i=0;i<760;i++){
 const along=r(0,routeLength),side=rand()<.5?-1:1,d=r(5.2,17),f=frameAt(along);
 if(nearBridge(along,9))continue;
 const p=f.p.clone().addScaledVector(f.n,side*d),sc=r(.55,1.25),shade=r(.62,.95);
 if(lakeSpots.some(l=>Math.hypot(p.x-l.x,p.z-l.z)<l.r+1)||inLake(p.x,p.z,1.5)||inBed(along,side*d))continue;
 if(side<0&&lakeK(along)>.05&&d>4.4)continue; // not on the lake bank
 dummy.rotation.set(0,r(0,Math.PI*2),0);dummy.scale.set(sc*r(.9,1.4),sc,sc*r(.9,1.4));
 dummy.position.set(p.x,groundY(along,side*d,f.p.y)+.5*sc,p.z);dummy.updateMatrix();
 tintC.setRGB(shade,shade*1.04,shade*.92);plants.bush.add(along/routeLength,dummy.matrix,tintC);
}
// ---- Lakeside showcase: the first 210 m, planted by hand to look like a kept city park ----
const srand2=makeRand(5521),q=(a,b)=>a+(b-a)*srand2();
function leafTree(x,y,z,u,size){ // an ordinary tree from the same kit as the rest of the park
 dummy.rotation.set(0,q(0,6.28),0);dummy.scale.setScalar(size);dummy.position.set(x,y+1.9*size,z);dummy.updateMatrix();plants.trunk.add(u,dummy.matrix);
 const sx=size*q(.9,1.2),sy=size*q(.9,1.2),sh=q(.78,1);dummy.position.y=y+5.0*size;dummy.scale.set(sx,sy,sx);dummy.updateMatrix();
 tintC.setRGB(sh*1.04,sh*1.02,sh*.84);(srand2()<.5?plants.crownA:plants.crownB).add(u,dummy.matrix,tintC);
 dummy.scale.set(sx*1.05,sy,sx*1.05);dummy.updateMatrix();plants.core.add(u,dummy.matrix);
}
function heroTree(dist,off,size){
 const f=frameAt(dist),p=f.p.clone().addScaledVector(f.n,off),y=groundY(dist,off,f.p.y)-.12,u=(((dist/routeLength)%1)+1)%1;
 dummy.rotation.set(0,q(0,6.28),0);dummy.scale.set(size,size*q(.92,1.08),size);dummy.position.set(p.x,y,p.z);dummy.updateMatrix();
 plants.heroTrunk.add(u,dummy.matrix);
 const sh=q(.82,1);tintC.setRGB(sh*1.05,sh*1.03,sh*.82);plants.heroCrown.add(u,dummy.matrix,tintC);
 for(const [cx,cy,cz,cs] of [[.3,8.9,0,1.5],[2.7,8.0,.4,1.1],[-2.4,8.1,1.9,1.1],[-1.4,8.2,-2.6,1.1]]){ // dark hearts so the crown is not see-through
  const m=new THREE.Matrix4().makeTranslation(cx,cy,cz).multiply(new THREE.Matrix4().makeScale(cs,cs*.72,cs));plants.core.add(u,dummy.matrix.clone().multiply(m));
 }
}
const reedSpots=[];
extra('showcase',()=>{
 // big shade trees: lake side close to the kerb, lawn side behind the flower beds
 for(const d of [-36,-14,6,25,45,66,86,107,128,150,171,193,214,238,264,292,322])heroTree(d+q(-2.5,2.5),-q(4.9,5.6),q(.92,1.12));
 for(const d of [-20,27,58,88,118,147,203,232,262])heroTree(d+q(-3,3),q(8.2,10.5),q(.95,1.15));
 // smaller trees filling the lawn behind
 for(let i=0;i<34;i++){const d=q(-10,220),off=q(12,19),f=frameAt(d),p=f.p.clone().addScaledVector(f.n,off);if(Math.abs(d-176)<10)continue;leafTree(p.x,groundY(d,off,f.p.y),p.z,(((d/routeLength)%1)+1)%1,q(.9,1.5));}
 // trees on the far shore of the lake
 for(let i=0;i<95;i++){
  const d=q(LAKE.a+20,LAKE.b-20),p=pointAt(d),rho=Math.hypot(p.x,p.z),w=LAKE.width*Math.sqrt(lakeK(d));if(w<40)continue;
  const rr=rho+6.5+w+q(4,40),x=p.x/rho*rr,z=p.z/rho*rr;leafTree(x,-.23,z,(((d/routeLength)%1)+1)%1,q(1.3,2.4));
 }
 // boulders and reeds along the water's edge
 for(let d=LAKE.a+30;d<LAKE.b-30;d+=q(.8,2.6)){
  const f=frameAt(d),n=srand2()<.3?3:1;
  for(let k=0;k<n;k++){
   const off=-q(5.9,7.3),dd=d+q(-.8,.8),ff=frameAt(dd),p=ff.p.clone().addScaledVector(ff.n,off),s=q(.22,.62)*(k?0.7:1)*(srand2()<.12?1.7:1);
   dummy.position.set(p.x,Math.max(groundY(dd,off,ff.p.y),WATER_Y-.1)+s*.12,p.z);dummy.rotation.set(q(-.3,.3),q(0,6.28),q(-.3,.3));dummy.scale.set(s*q(.9,1.5),s*q(.7,1),s*q(.9,1.3));dummy.updateMatrix();
   const g=q(.78,1.05);tintC.setRGB(g,g,g*1.02);plants.rock.add((((dd/routeLength)%1)+1)%1,dummy.matrix,tintC);
  }
  if(srand2()<.55){const off=-q(6.0,6.9),p=f.p.clone().addScaledVector(f.n,off);for(let k=0;k<4;k++)reedSpots.push({x:p.x+q(-.5,.5),y:Math.max(groundY(d,off,f.p.y),WATER_Y)-.03,z:p.z+q(-.5,.5),s:q(.7,1.25)});}
 }
 // flower beds: bark mulch with a stone edge, hydrangea-style bushes in drifts of one colour
 const mulchMat=new THREE.MeshStandardMaterial({map:photo.mulch||null,color:photo.mulch?0xffffff:0x4a3a2c,roughness:1});
 const kerbMat=new THREE.MeshStandardMaterial({map:photo.kerb||null,color:photo.kerb?0xe6e2da:0x9a9488,roughness:.95});
 const bedY=(d,o,py)=>groundY(d,o,py)+.045;
 for(const [d0,d1] of BEDS){
  strip(d0,d1,2,2.68,6.3,bedY,mulchMat,(d,o)=>[o/1.8,d/1.8]);
  strip(d0,d1,2,6.3,6.58,(d,o,py)=>groundY(d,o,py)+.09,kerbMat,(d,o,k)=>[k*.2,d/1.7]);
  const cols=[0xf07fb0,0xf7a9c8,0xfbfbf6,0xb48fe6,0xe85a94];
  for(let d=d0+.9;d<d1-.6;d+=q(1.5,2.0)){
   const col=cols[Math.floor(noise2(d/7+3,d0)*cols.length*.999)];
   for(const row of [3.75,5.35]){
    if(srand2()<.1)continue;
    const dd=d+q(-.4,.4),off=row+q(-.3,.3),f=frameAt(dd),p=f.p.clone().addScaledVector(f.n,off),sc=q(.72,1.02)*(row>5?1.12:.95),u=(((dd/routeLength)%1)+1)%1;
    dummy.rotation.set(0,q(0,6.28),0);dummy.scale.set(sc,sc*q(.95,1.15),sc);dummy.position.set(p.x,groundY(dd,off,f.p.y)+.52*sc,p.z);dummy.updateMatrix();
    const g=q(.7,.92);tintC.setRGB(g,g*1.05,g*.86);plants.bush.add(u,dummy.matrix,tintC);
    tintC.set(col).multiplyScalar(q(.9,1.05));plants.bloom.add(u,dummy.matrix,tintC);
   }
  }
 }
 // kerb stones along both edges of the path, all the way round
 strip(0,routeLength,2,-2.68,-2.22,(d,o,py)=>py+.012,kerbMat,(d,o,k)=>[k*.22,d/1.7]);
 strip(0,routeLength,2,2.22,2.68,(d,o,py)=>py+.012,kerbMat,(d,o,k)=>[.5+k*.22,d/1.7]);
 // gazebo on the lawn with a paved walk up to it
 {const d=176,off=14,f=frameAt(d),p=f.p.clone().addScaledVector(f.n,off),gz=buildGazebo();
  gz.position.set(p.x,groundY(d,off,f.p.y)-.02,p.z);gz.rotation.y=Math.atan2(-f.n.x,-f.n.z);gz.scale.setScalar(1.08);scene.add(gz);
  strip(d-1.3,d+1.3,1.3,2.68,10.6,(dd,o,py)=>groundY(dd,o,py)+.05,kerbMat,(dd,o,k)=>[k*3,(dd-d)/2.2]);}
 // benches facing the path
 const benchWood=new THREE.MeshStandardMaterial({color:0x8a5a34,roughness:.8}),benchIron=new THREE.MeshStandardMaterial({color:0x1b1d1f,roughness:.5,metalness:.6});
 for(const [d,off] of [[90,3.7],[156.5,3.6],[214,3.7]]){const f=frameAt(d),p=f.p.clone().addScaledVector(f.n,off),b=buildBench(benchWood,benchIron);
  b.position.set(p.x,groundY(d,off,f.p.y)+.02,p.z);b.rotation.y=Math.atan2(-f.n.x,-f.n.z);scene.add(b);}
});
const plantMeshes=[];for(const key in plants)if(plants[key] instanceof Scatter)plantMeshes.push(...plants[key].build(scene));
extra('reeds',()=>makeReeds(scene,srand2,reedSpots));
const tufts=makeTufts(scene,srand,{frameAt,groundY,routeLength,skip:(d,off)=>nearBridge(d,9)||inBed(d,off)||(off<-6.3&&lakeK(d)>.25)});
extra('hills',()=>buildHills(scene,{frameAt,routeLength}));
extra('mist',()=>{mistUpdate=buildMist(scene,fallSpot.c);});

// Route-specific landmarks: park furniture, flowers, distant hills, direction signs.
const boxGeo=new THREE.BoxGeometry(1,1,1);
function bench(fraction,side){
 const f=atFraction(fraction),p=f.p.clone().addScaledVector(f.n,side*6.5);
 const b=new THREE.Group();b.position.copy(p);b.rotation.y=Math.atan2(f.v.x,f.v.z);scene.add(b);
 const seat=mesh(boxGeo,mats.wood);seat.position.y=.56;seat.scale.set(1.4,.12,.46);b.add(seat);
 const back=mesh(boxGeo,mats.wood);back.position.set(0,1.07,-.2);back.scale.set(1.4,.83,.10);b.add(back);
 for(let x of [-.54,.54]){const leg=mesh(boxGeo,mats.metal);leg.position.set(x,.29,0);leg.scale.set(.08,.57,.41);b.add(leg);}
}
for(let i=0;i<26;i++){const u=(.03+i*.037)%1,rd=relDist(u*routeLength);if(rd>-15&&rd<225)continue;bench(u,lakeK(u*routeLength)>.05?1:(i%2?1:-1));}
const flowerKit=makeFlowers(srand);
const FLOWERS=2600,flowerInst=new THREE.InstancedMesh(flowerKit.geo,flowerKit.mat,FLOWERS);
const petal=[0xf7a8c0,0xffffff,0xffe27a,0xc9a6ff,0xff8f73],tint=new THREE.Color();
for(let i=0;i<FLOWERS;){
 // one patch of about ten flowers, all the same colour
 const fd=r(0,routeLength),f=frameAt(fd),side=rand()<.5?-1:1,off=r(3.6,9),c=f.p.clone().addScaledVector(f.n,side*off),gy=groundY(fd,side*off,f.p.y);
 tint.set(petal[Math.floor(r(0,petal.length))]);
 for(let k=0;k<10&&i<FLOWERS;k++,i++){
  dummy.position.set(c.x+r(-.9,.9),gy,c.z+r(-.9,.9));dummy.rotation.set(0,r(0,Math.PI),0);dummy.scale.setScalar(nearBridge(fd,9)||inBed(fd,side*off)||(side<0&&off>5.6&&lakeK(fd)>.25)?0:r(.7,1.3));dummy.updateMatrix();
  flowerInst.setMatrixAt(i,dummy.matrix);flowerInst.setColorAt(i,tint);
 }
}
if(flowerInst.instanceColor)flowerInst.instanceColor.needsUpdate=true;
flowerInst.castShadow=false;
flowerInst.instanceMatrix.needsUpdate=true;scene.add(flowerInst);

// A skinned human GLB is used where available. Without it a rigged geometric person is shown,
// clearly identified as a graphics fallback. Realism depends on supplied model and textures.
let avatar=new THREE.Group(),mixer=null,currentAnimation='',characterQuality='fallback',characterClips=[],characterNote='';
const actions={};
// Ground speed (km/h) at which each clip's planted foot does not slide, at the model's own size.
// Measured from the Maya model's foot motion: Walk_Relaxed 1.30 m/s, Walk_Brisk 1.70, Jog 2.80, Run 4.50.
let nativeKmh={relaxed:4.68,brisk:6.12,jog:10.08,run:16.2};
let avatarLift=.03;
scene.add(avatar);
function bodyPart(parent,geo,mat,pos,rot=0){let o=mesh(geo,mat);o.position.set(...pos);o.rotation.x=rot;parent.add(o);return o;}
const skin=new THREE.MeshStandardMaterial({color:0xc88f70,roughness:.91}),shirt=new THREE.MeshStandardMaterial({color:0x478f99,roughness:.95}),pants=new THREE.MeshStandardMaterial({color:0x1a2b36,roughness:1}),shoe=new THREE.MeshStandardMaterial({color:0xf0f1e9,roughness:.88});
let proceduralRig;
function createFallbackHuman(){
 const root=new THREE.Group(),arms=[],legs=[];
 bodyPart(root,new THREE.CylinderGeometry(.19,.25,.69,11),shirt,[0,1.22,0]);
 bodyPart(root,new THREE.SphereGeometry(.15,12,10),skin,[0,1.80,0]);
 bodyPart(root,new THREE.CylinderGeometry(.10,.11,.2,12),skin,[0,1.61,0]);
 bodyPart(root,new THREE.CylinderGeometry(.21,.18,.31,10),pants,[0,.79,0]);
 bodyPart(root,new THREE.SphereGeometry(.16,8,8),pants,[0,1.93,0]);
 for(const s of [-1,1]){
  let a=new THREE.Group();a.position.set(s*.25,1.47,0);root.add(a);
  bodyPart(a,new THREE.CylinderGeometry(.10,.085,.6,9),shirt,[s*.04,-.26,0],s*.09);
  bodyPart(a,new THREE.SphereGeometry(.085,8,8),skin,[s*.09,-.58,.01]);arms.push({a,s});
  let l=new THREE.Group();l.position.set(s*.125,.74,0);root.add(l);
  bodyPart(l,new THREE.CylinderGeometry(.112,.084,.65,9),pants,[0,-.30,0]);
  bodyPart(l,new THREE.CylinderGeometry(.085,.065,.36,8),pants,[0,-.74,0]);
  bodyPart(l,new THREE.BoxGeometry(.15,.13,.35),shoe,[0,-.94,.09]);legs.push({l,s});
 }
 return {root,arms,legs};
}
proceduralRig=createFallbackHuman();avatar.add(proceduralRig.root);
function updateFallback(dt){
 state.frame += dt*Math.max(.15,state.pace/5)*6.9;
 const sw=Math.sin(state.frame),lean=state.pace>7?.13:.03;
 proceduralRig.root.rotation.x=lean;
 proceduralRig.root.position.y= Math.abs(Math.sin(state.frame))*Math.min(.055,state.pace*.009);
 for(const {a,s} of proceduralRig.arms)a.rotation.x=sw*s*(state.pace>7?.62:.46);
 for(const {l,s} of proceduralRig.legs)l.rotation.x=-sw*s*(state.pace>7?.71:.46);
}
const modelLoader=new GLTFLoader();
function loadGLB(url){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Timed out loading 3D character')),90000);modelLoader.load(url,g=>{clearTimeout(timeout);resolve(g);},undefined,e=>{clearTimeout(timeout);reject(e);});});}
async function loadRunner(){
 // Bundled with the app first; the public copy on innerscene.com is only a backup.
 const options=[
  './assets/maya-locomotion.glb',
  'https://files.innerscene.com/library/locomotion-collection-maya-3d-person-animated-1499b2fd/565cfb8a45b8a67a79c4/locomotion-collection-maya-3d-person-animated.glb'
 ];
 for(const url of options){
  try{
   const gltf=await loadGLB(url);
   const body=gltf.scene;body.updateMatrixWorld(true);
   const clips=gltf.animations||[];
   const norm=c=>String(c.name||'').toLowerCase().replace(/[_\-]+/g,' ');
   const get=(...terms)=>{for(const t of terms){const c=clips.find(c=>norm(c).includes(t));if(c)return c;}return null;};
   const isMaya=!!get('walk relaxed')&&!!get('jog');
   const bb=new THREE.Box3().setFromObject(body);const sz=bb.getSize(new THREE.Vector3());
   if(sz.y<.01)throw new Error('Invalid character scale');
   // The Maya model is already life size (about 1.68 m). Keeping its size keeps the measured stride speeds exact.
   const scale=isMaya?1:1.72/sz.y;
   if(scale!==1){body.scale.multiplyScalar(scale);for(const k in nativeKmh)nativeKmh[k]*=scale;}
   body.position.y=isMaya?0:-bb.min.y*scale;
   body.traverse(o=>{if(o.isMesh){o.castShadow=true;o.frustumCulled=false;}});
   // The model holds a phone in one hand. Hidden for walking and running.
   for(const n of ['Phone','phone']){const held=body.getObjectByName(n);if(held)held.visible=false;}
   avatar.remove(proceduralRig.root);avatar.add(body);
   avatarLift=-.03;
   const m=new THREE.AnimationMixer(body);
   const pick={idle:get('idle'),relaxed:get('walk relaxed','relaxed walk','walk'),brisk:get('walk brisk','brisk walk'),jog:get('jog'),run:get('run')};
   for(const k in pick)if(pick[k])actions[k]=m.clipAction(pick[k]);
   if(!actions.relaxed&&clips[0])actions.relaxed=m.clipAction(clips[0]);
   if(!actions.brisk)actions.brisk=actions.relaxed;
   if(!actions.jog)actions.jog=actions.run||actions.brisk;
   if(!actions.run)actions.run=actions.jog;
   characterClips=clips.map(c=>c.name);
   characterQuality=isMaya?'maya':'model';
   characterNote=url.startsWith('./')?'bundled':'online';
   currentAnimation='';mixer=m;
   console.info('Loaded animated person:',url,'clips',characterClips);
   return;
  }catch(err){console.info('3D person not loaded from',url,err&&err.message);}
 }
 characterQuality='fallback';characterNote='model file did not load';
}
// Which clip suits the pace. Bands overlap a little so the clip does not flicker at a boundary.
function wantedAnimation(){
 if(!state.playing||state.pace<.3)return actions.idle?'idle':(currentAnimation&&currentAnimation!=='idle'?currentAnimation:'relaxed');
 const v=state.pace,c=currentAnimation;
 if(c==='relaxed')return v>5.5?'brisk':'relaxed';
 if(c==='brisk')return v>7.5?'jog':v<5.1?'relaxed':'brisk';
 if(c==='jog')return v>12.2?'run':v<7.1?'brisk':'jog';
 if(c==='run')return v<11.8?'jog':'run';
 return v<5.3?'relaxed':v<7.3?'brisk':v<12?'jog':'run';
}
function animateRunner(dt){
 if(mixer){
  try{
   const next=wantedAnimation();
   if(next!==currentAnimation){
    const a=actions[next],b=actions[currentAnimation];
    if(a&&a!==b){
     a.reset();
     // Start the new clip at the same point in the stride so the feet do not jump.
     if(b&&next!=='idle'&&currentAnimation!=='idle'){const db=b.getClip().duration,da=a.getClip().duration;if(db>0)a.time=(b.time/db)*da;}
     a.setEffectiveWeight(1);a.fadeIn(.4).play();
     if(b)b.fadeOut(.4);
    }
    currentAnimation=next;
   }
   const a=actions[currentAnimation];
   // Play speed = pace / the clip's own ground speed, so the planted foot keeps pace with the path.
   if(a)a.timeScale=currentAnimation==='idle'?1:clamp(state.pace/nativeKmh[currentAnimation],.3,2);
   mixer.update((state.playing||currentAnimation==='idle')?dt:0);
  }catch(err){
   console.info('Character animation stopped:',err&&err.message);
   mixer=null;characterQuality='model-static';characterNote='animation error: '+(err&&err.message);
  }
 }else if(state.playing&&characterQuality==='fallback')updateFallback(dt);
}

const placeNames=[{at:0,label:'Lakeside Promenade · Start'},{at:.14,label:'Willow Gardens · Curving Lakeside Path'},{at:.195,label:'Wooden Bridge · Stream Crossing'},{at:.28,label:'Sunlit Meadow · Winding Trail'},{at:.40,label:'Cascade Approach · Waterfall Ahead'},{at:.44,label:'Waterfall Lookout · Cascading Falls'},{at:.53,label:'Garden Curve · Flower Walk'},{at:.60,label:'Hill Climb · Uphill Forest Path'},{at:.68,label:'Second Bridge · Woodland Stream'},{at:.78,label:'Pine Grove · Quiet Forest'},{at:.89,label:'Lakeside Return · Finishing Stretch'}];
const clock=new THREE.Clock();let lastUi=0,modelReady=false;
let smoothedCam=new THREE.Vector3(),smoothedTarget=new THREE.Vector3();let cameraInitialized=false;
const mapCtx=ui.map.getContext('2d');
function updateMap(){
 const c=mapCtx,w=ui.map.width,h=ui.map.height;
 const points=Array.from({length:250},(_,i)=>pointAt(i/250*routeLength));
 const xs=points.map(p=>p.x),zs=points.map(p=>p.z),xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs);
 const s=Math.min((w-25)/(xmax-xmin),(h-18)/(zmax-zmin));
 function xy(p){return [w/2+(p.x-(xmin+xmax)/2)*s,h/2+(p.z-(zmin+zmax)/2)*s];}
 c.clearRect(0,0,w,h);c.lineWidth=8;c.strokeStyle='rgba(192,242,221,.18)';c.lineJoin='round';c.beginPath();points.forEach((p,i)=>{let [x,y]=xy(p);i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.stroke();
 c.lineWidth=3;c.strokeStyle='#75e8bc';c.stroke();
 for(const f of [.20,.44,.62,.83]){let [x,y]=xy(pointAt(f*routeLength));c.fillStyle='#e1f7e7';c.beginPath();c.arc(x,y,3.2,0,2*Math.PI);c.fill();}
 const p=pointAt(state.meters%routeLength),[x,y]=xy(p);c.fillStyle='#23dce0';c.beginPath();c.arc(x,y,6.5,0,2*Math.PI);c.fill();c.lineWidth=2;c.strokeStyle='#ffffff';c.stroke();
}
function updateUI(){
 const m=Math.floor(state.seconds/60),s=Math.floor(state.seconds%60),f=state.meters/FULL;
 ui.time.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
 ui.distance.innerHTML=(state.meters/1000).toFixed(2)+' <small>km</small>';
 ui.speed.innerHTML=state.pace.toFixed(1)+' <small>km/h</small>';
 ui.calories.innerHTML=Math.round(state.seconds/60*4.1*(state.pace/5))+' <small>kcal</small>'; // illustrative estimate, not biometrics
 ui.controlSpeed.textContent=state.manualPace.toFixed(1);
 ui.progress.style.width=(f*100).toFixed(1)+'%';ui.percent.textContent=Math.floor(f*100)+'%';
 let point=placeNames[0];for(const p of placeNames)if(f>=p.at)point=p;
 ui.landmark.textContent=point.label;
 document.querySelectorAll('.checkpoint').forEach((e,i)=>{const loc=Number(e.dataset.spot);e.classList.toggle('active', Math.abs(f-loc)<.04);});
 updateMap();
}
function setPace(v){state.manualPace=clamp(Math.round(v*10)/10,1,12);ui.slider.value=state.manualPace;if(state.mode==='demo')state.pace=state.manualPace;updateUI();}
function setRunning(v){state.playing=!!v;$('playIcon').textContent=v?'Ⅱ':'▶';$('playLabel').textContent=v?'Pause Walk':'Resume Walk';}
$('minus').onclick=()=>setPace(state.manualPace-.5);
$('plus').onclick=()=>setPace(state.manualPace+.5);
ui.slider.oninput=e=>setPace(Number(e.target.value));
$('playPause').onclick=()=>setRunning(!state.playing);
$('resetBtn').onclick=()=>{state.meters=0;state.seconds=0;state.frame=0;state.mode='demo';state.pace=state.manualPace;updateSource();setRunning(true);updateUI();};
$('thirdView').onclick=()=>{state.view='third';$('thirdView').classList.add('selected');$('firstView').classList.remove('selected');cameraInitialized=false;};
$('firstView').onclick=()=>{state.view='first';$('firstView').classList.add('selected');$('thirdView').classList.remove('selected');cameraInitialized=false;};
$('expandBtn').onclick=async()=>{if(document.fullscreenElement)await document.exitFullscreen();else if($('app').requestFullscreen)await $('app').requestFullscreen();};
document.querySelectorAll('.checkpoint').forEach(el=>el.onclick=()=>{
 // Clearly labeled jump-ahead preview, not an activity that the user has physically completed.
 let f=Number(el.dataset.spot);state.meters=f*FULL;state.seconds=0;setRunning(true);
 $('tip').textContent='Preview jump: virtual distance changed. This does not represent actual distance walked.';
 cameraInitialized=false;updateUI();
});
function updateSource(){
 const live=state.mode==='live';ui.source.textContent=live?'● VERIFIED SPEED FEED':'● SIMULATION MODE';
 ui.source.classList.toggle('live',live);ui.source.classList.toggle('demo',!live);
 ui.slider.disabled=live;$('minus').disabled=live;$('plus').disabled=live;
}
window.addEventListener('proform:telemetry',ev=>{
 const d=ev.detail||{};
 if(d.verified===true && Number.isFinite(d.speedKmh)&&d.speedKmh>=0&&d.speedKmh<=16){
  state.mode='live';state.pace=d.speedKmh;state.liveLast=performance.now();updateSource();
 }
});
window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.source!==parent)return;
 if(e.data?.type==='PROFORM_VERIFIED_SPEED'){
  window.dispatchEvent(new CustomEvent('proform:telemetry',{detail:{speedKmh:e.data.speedKmh,verified:e.data.verified===true}}));
 }
});
// For testing only: window.__parkStep(seconds) draws exactly one frame that far on, so a recording can be made frame by frame.
let manualClock=false;
window.__parkStep=dt=>{manualClock=true;frame(clamp(Number(dt)||0,0,.25));};
function animate(){
 requestAnimationFrame(animate);
 if(!manualClock)frame(Math.min(clock.getDelta(),.09));
}
function frame(dt){
 waterTime+=dt;
 if(state.mode==='live' && performance.now()-state.liveLast>4500){
  state.mode='demo';state.pace=0;setRunning(false);updateSource();
  $('tip').textContent='Verified treadmill speed feed stopped. The avatar is paused; no motor command was sent.';
 }
 if(state.playing){
  let delta=state.pace/3.6*dt;
  state.meters=EMBED?(state.meters+delta)%FULL:Math.min(FULL,state.meters+delta);
  state.seconds+=dt;
  if(!EMBED&&state.meters>=FULL){setRunning(false);$('tip').textContent='3.0 km park route completed. Press Reset to enjoy another lap.';}
 }
 const f=frameAt(state.meters/FULL*routeLength),{p,v,n}=f;
 avatar.position.copy(p);avatar.position.y+=avatarLift;
 avatar.rotation.y=Math.atan2(v.x,v.z);
 avatar.visible=state.view==='third';
 animateRunner(dt);
 let desired=new THREE.Vector3(),target=new THREE.Vector3();
 if(state.view==='third'){
  const tall=camera.aspect<1;
  desired.copy(p).addScaledVector(v,tall?-4.2:-3.9).addScaledVector(n,tall?.7:.95);desired.y=p.y+(tall?2.2:2.0);
  target.copy(p).addScaledVector(v,tall?6:9);target.y=p.y+(tall?1.15:1.3);
 }else{
  desired.copy(p).addScaledVector(v,.72);desired.y=p.y+1.66;
  target.copy(p).addScaledVector(v,18);target.y=p.y+1.64;
 }
 // Near the waterfall the camera turns part of the way towards it, so it is seen while walking past.
 {const along=state.meters/FULL*routeLength-fallSpot.at;if(state.view==='third'&&along>-110&&along<35){const k=along<0?1-(-along/110):1-along/35,w=.34*k*k*(3-2*k);
  const dw=fallSpot.c.clone().sub(p);dw.y=0;dw.normalize();const dir=v.clone().multiplyScalar(1-w).addScaledVector(dw,w).normalize();
  const ty=target.y;target.copy(p).addScaledVector(dir,7);target.y=ty+1.2*w;}}
 if(!cameraInitialized){smoothedCam.copy(desired);smoothedTarget.copy(target);cameraInitialized=true;}
 const lerp=1-Math.exp(-dt*4.6);smoothedCam.lerp(desired,lerp);smoothedTarget.lerp(target,lerp);
 camera.position.copy(smoothedCam);camera.lookAt(smoothedTarget);
 // Update light position around runner so shadows are useful across the whole 3 km world.
 sun.position.copy(p).add(SUN);sun.target.position.copy(p);sun.target.updateMatrixWorld();
 for(let i=0;i<animatedWater.length;i++){const w=animatedWater[i];w.drop.position.y=w.origin.y+((waterTime*w.speed+i*.4)%5)*-.9;if(w.drop.position.y<.06)w.drop.position.y=w.origin.y;}
 fallingSheets.forEach((m,i)=>m.material.opacity=.82+.1*Math.sin(waterTime*5+i));
 if(photo.waterN){photo.waterN.offset.x=(photo.waterN.offset.x+dt*.006)%1;photo.waterN.offset.y=(photo.waterN.offset.y+dt*.011)%1;}
 waterTex.offset.x=(waterTex.offset.x+dt*.012)%1;waterTex.offset.y=(waterTex.offset.y+dt*.03)%1;fallTex.offset.y=(fallTex.offset.y+dt*.85)%1;
 sky.position.copy(camera.position);mistUpdate(waterTime);
 if(tufts.mesh.visible)tufts.update(state.meters/FULL*routeLength);
 if(!EMBED&&performance.now()-lastUi>240){updateUI();lastUi=performance.now();}
 renderer.render(scene,camera);
 frameCount++;fpsFrames++;
 {const tn=performance.now();if(tn-fpsSince>2000){fpsNow=fpsFrames*1000/(tn-fpsSince);fpsFrames=0;fpsSince=tn;}}
}
function resized(){let w=canvasHost.clientWidth,h=canvasHost.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);}
window.addEventListener('resize',resized);
// Graphics quality, chosen in the app. Low = no shadows, lower resolution, shorter view distance.
let currentQuality='medium';
function setQuality(q){
 if(q!=='low'&&q!=='medium'&&q!=='high')return;
 currentQuality=q;
 const dpr=window.devicePixelRatio||1;
 renderer.setPixelRatio(q==='low'?Math.min(dpr,1):q==='high'?Math.min(dpr,2):Math.min(dpr,1.5));
 const shadows=q!=='low';
 if(renderer.shadowMap.enabled!==shadows){
  renderer.shadowMap.enabled=shadows;sun.castShadow=shadows;
  scene.traverse(o=>{if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{m.needsUpdate=true;});}});
 }
 const size=q==='high'?2048:1024;
 if(sun.shadow.mapSize.x!==size){sun.shadow.mapSize.set(size,size);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}}
 camera.far=q==='low'?240:420;scene.fog.density=q==='low'?.0075:.0034;camera.updateProjectionMatrix();
 tufts.mesh.visible=q!=='low';sky.scale.setScalar(q==='low'?.55:1);
 resized();
}
let lastLandmark='';
function landmarkNow(){const f=state.meters/FULL;let point=placeNames[0];for(const p of placeNames)if(f>=p.at)point=p;return point.label;}
// The host app sends pace, play/pause, position on the lap, camera and quality. Nothing here reaches the treadmill.
function applyHostCommand(d){
 if(Number.isFinite(d.pace)){state.manualPace=clamp(d.pace,0,20);state.pace=state.manualPace;}
 if(typeof d.playing==='boolean')state.playing=d.playing;
 if((d.view==='first'||d.view==='third')&&d.view!==state.view){state.view=d.view;cameraInitialized=false;}
 if(Number.isFinite(d.meters)){
  const target=((d.meters%FULL)+FULL)%FULL;let diff=Math.abs(target-state.meters);diff=Math.min(diff,FULL-diff);
  if(diff>3){if(diff>25)cameraInitialized=false;state.meters=target;}
 }
 if(d.quality&&d.quality!==currentQuality)setQuality(d.quality);
}
const bridge=initBridge({
 onCommand:applyHostCommand,
 getStatus:()=>({meters:Number(state.meters)||0,playing:!!state.playing,pace:Number(state.pace)||0,view:state.view,quality:currentQuality,landmark:landmarkNow(),character:characterQuality,characterNote,clips:characterClips,animation:currentAnimation,frames:frameCount,fps:Math.round(fpsNow),photoTextures:photo.count+'/'+photo.total,photoMissing:photo.missing})
});
updateUI();updateSource();resized();animate();
window.__parkReady=true;
ui.loadTitle.textContent='Setting up the animated character…';ui.loadDesc.textContent='Path, bridges, waterfall and scenery are ready.';
// Don't hold the whole experience hostage to a slow optional model download.
setTimeout(()=>{ui.loading.hidden=true;},1300);
bridge.ready({routeMeters:FULL,route:Array.from({length:160},(_,i)=>{const p=pointAt(i/160*routeLength);return [Math.round(Number(p.x)*10)/10,Math.round(Number(p.z)*10)/10,Math.round(Number(p.y)*100)/100];})});
loadRunner().then(()=>{ui.loading.hidden=true;console.info('Character quality:',characterQuality);});
