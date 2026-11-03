// GLSL for planets, moons, rings, atmospheres, stars and the camera. All lighting is computed body-relative
// (positions relative to the body centre) so there are no float-precision problems at solar-system distances.

export const LOGDEPTH_VS_PARS = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
export const LOGDEPTH_FS_PARS = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';

const NOISE = /* glsl */ `
float ss(float a,float b,float x){ float t=clamp((x-a)/(b-a),0.,1.); return t*t*(3.-2.*t); }
float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
float vnoise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
// fbm with per-octave anti-aliasing: fw = screen-space footprint of p (in noise units)
float fbm(vec3 p, float fw, int oct){
  float a=0.5, s=0., f=1.;
  for(int i=0;i<7;i++){ if(i>=oct) break;
    float fade=1.-smoothstep(0.3,0.85,fw*f);
    s+=a*fade*(vnoise(p*f)-0.5); f*=2.03; a*=0.5; p+=vec3(7.1,3.7,5.3); }
  return s+0.5;
}
// noise stretched along longitude (for zonal flows); d = unit direction in body frame
float zonal(vec3 d, float lonFreq, float latFreq, float fw, int oct, float seed){
  float lon=atan(d.y,d.x), lat=asin(clamp(d.z,-1.,1.));
  vec3 q=vec3(cos(lon)*lonFreq, sin(lon)*lonFreq, lat*latFreq+seed);
  return fbm(q, fw*max(lonFreq,latFreq), oct);
}
`;

const OCCLUDE = /* glsl */ `
#define MAXOCC 10
uniform vec4 uOcc[MAXOCC]; uniform int uOccN; uniform int uSelf; uniform float uSunAng; uniform vec3 uSunDir;
float occlusion(vec3 P){
  float vis=1.;
  for(int i=0;i<MAXOCC;i++){ if(i>=uOccN) break; if(i==uSelf) continue;
    vec3 oc=uOcc[i].xyz-P; float tca=dot(oc,uSunDir); if(tca<=0.) continue;
    float dist=length(cross(oc,uSunDir)); float ao=uOcc[i].w/tca; float th=dist/tca;
    float ov=clamp((uSunAng+ao-th)/(2.*min(uSunAng,ao)),0.,1.); ov=ov*ov*(3.-2.*ov);
    vis*=1.-ov*min(1.,(ao*ao)/(uSunAng*uSunAng));
  }
  return vis;
}
`;

const RING = /* glsl */ `
uniform int uRingType; uniform float uRingR;
float rh(float x){ return fract(sin(x*127.1)*43758.5453); }
float rn(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(rh(i),rh(i+1.),f); }
float rfbm(float x, float fw){ float s=0., a=0.5, f=1.; for(int i=0;i<5;i++){ s+=a*(rn(x*f)-0.5)*(1.-smoothstep(0.3,0.9,fw*f)); f*=2.7; a*=0.55; } return s+0.5; }
float thinRing(float rkm, float c, float hw, float tau, float fwkm){ float w=max(hw,1.3*fwkm); return tau*(hw/w)*(1.-smoothstep(0.6*w,w,abs(rkm-c))); }
// optical depth and albedo colour at radius r (planet radii)
float ringTau(float r, float fwr, out vec3 col){
  float tau=0.; col=vec3(0.3);
  if(uRingType==1){
    float f1=rfbm(r*260.,fwr*260.), f2=rfbm(r*1500.,fwr*1500.);
    float D=smoothstep(1.11,1.15,r)*(1.-smoothstep(1.2,1.239,r));
    tau=0.012*D; col=vec3(0.35,0.33,0.3);
    float C=smoothstep(1.239,1.246,r)*(1.-smoothstep(1.52,1.527,r));
    float tC=(0.09+0.2*rfbm(r*45.,fwr*45.))*(0.55+0.9*f1);
    tau=mix(tau,tC,C); col=mix(col,vec3(0.33,0.3,0.27),C);
    float B=smoothstep(1.527,1.536,r)*(1.-smoothstep(1.94,1.951,r));
    float tB=(0.75+1.6*smoothstep(1.527,1.75,r))*(0.6+0.8*rfbm(r*80.,fwr*80.))*(0.7+0.6*f1)*(0.85+0.3*f2);
    tau=mix(tau,tB,B); col=mix(col,vec3(0.86,0.73,0.56),B);
    float G=smoothstep(1.951,1.958,r)*(1.-smoothstep(2.02,2.027,r));
    float tG=(0.05+0.14*rfbm(r*70.,fwr*70.));
    tau=mix(tau,tG,G); col=mix(col,vec3(0.28,0.26,0.24),G);
    float A=smoothstep(2.027,2.034,r)*(1.-smoothstep(2.262,2.269,r));
    float tA=(0.45+0.35*(1.-(r-2.027)/0.242))*(0.65+0.7*rfbm(r*110.,fwr*110.))*(0.8+0.4*f1);
    tA*=mix(0.02,1.,smoothstep(0.0022,0.0050,abs(r-2.2166)));
    tA*=mix(0.05,1.,smoothstep(0.0004,0.0012,abs(r-2.2649)));
    tau=mix(tau,tA,A); col=mix(col,vec3(0.74,0.63,0.5),A);
    float fk=fwr*uRingR; tau+=thinRing(r*uRingR,140180.,25.,0.35,fk); // F ring
  } else if(uRingType==2){
    col=vec3(0.09,0.085,0.08); float fk=fwr*uRingR, rk=r*uRingR;
    tau+=thinRing(rk,41837.,1.5,0.35,fk); tau+=thinRing(rk,42234.,1.5,0.35,fk); tau+=thinRing(rk,42570.,1.5,0.35,fk);
    tau+=thinRing(rk,44718.,4.,0.35,fk);  tau+=thinRing(rk,45661.,5.,0.3,fk);   tau+=thinRing(rk,47176.,1.,0.25,fk);
    tau+=thinRing(rk,47627.,2.,0.25,fk);  tau+=thinRing(rk,48300.,3.,0.3,fk);   tau+=thinRing(rk,50024.,1.,0.2,fk);
    tau+=thinRing(rk,51149.,45.,0.7,fk);
  } else if(uRingType==3){
    col=vec3(0.12,0.1,0.09); float fk=fwr*uRingR, rk=r*uRingR;
    tau+=thinRing(rk,41900.,1000.,0.0004,fk); tau+=thinRing(rk,53200.,60.,0.012,fk); tau+=thinRing(rk,62933.,40.,0.02,fk);
  }
  return tau;
}
float ringShadow(vec3 pObj, vec3 sObj){ // pObj: point relative to planet centre in body frame
  if(uRingType==0 || abs(sObj.z)<1e-3) return 1.;
  float t=-pObj.z/sObj.z; if(t<=0.) return 1.;
  vec3 h=pObj+sObj*t; float r=length(h.xy)/uRingR; vec3 c;
  float tau=ringTau(r,0.003,c);
  return exp(-tau/max(abs(sObj.z),0.05));
}
`;

// ---------------------------------------------------------------------------------------------
export const BODY_VS = LOGDEPTH_VS_PARS + /* glsl */ `
varying vec3 vPosObj; uniform vec3 uRadii;
void main(){ vPosObj=position*uRadii*1.02; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
#include <logdepthbuf_vertex>
}`;
export const SUN_VS = LOGDEPTH_VS_PARS + /* glsl */ `
varying vec3 vObj;
void main(){ vObj=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
#include <logdepthbuf_vertex>
}`;

// Planets and moons are ray-traced analytic ellipsoids: the mesh only bounds the silhouette.
const ANALYTIC = /* glsl */ `
  mat3 R=mat3(uAx,uAy,uAz);
  vec3 camO=transpose(R)*uCamRel;
  vec3 ro=camO/uRadii; vec3 rdn=normalize((vPosObj-camO)/uRadii);
  vec3 hv=ro-rdn*dot(ro,rdn); float hm=length(hv);
  float cov=clamp((1.-hm)/max(fwidth(hm),1e-5)+0.5,0.,1.);
  vec3 hit=hm>0.9999 ? hv/hm : hv-rdn*sqrt(1.-hm*hm);
  { vec3 pv=mat3(viewMatrix)*(R*(hit*uRadii)-uCamRel); gl_FragDepth=log2(1.+max(-pv.z,0.))*logDepthBufFC*0.5; }
`;
const BODY_UNIFORMS = /* glsl */ `
uniform vec3 uAx,uAy,uAz,uCamRel,uRadii; uniform float uIrr;
varying vec3 vPosObj;
`;

const SUN_K = '1.05';

// ---------------------------------------------------------------------------------------------
// Giant planets and Earth
const _PLANET_FS = LOGDEPTH_FS_PARS + NOISE + OCCLUDE + RING + BODY_UNIFORMS + /* glsl */ `
uniform int uMode; // 0 Jupiter map, 1 Saturn, 2 Uranus, 3 Neptune, 4 Earth, 5 plain textured
uniform sampler2D uMap, uRamp, uMap2, uMap3, uMap4;
uniform float uTime;
vec4 texWrap(sampler2D t, vec2 uv){ vec2 gx=dFdx(uv), gy=dFdy(uv); gx.x-=floor(gx.x+0.5); gy.x-=floor(gy.x+0.5); return textureGrad(t,uv,gx,gy); }
vec3 satur(vec3 c,float s){ float l=dot(c,vec3(.299,.587,.114)); return mix(vec3(l),c,s); }
void main(){
${ANALYTIC}
  vec3 d=hit;                                  // body-frame direction (geocentric lat/lon)
  float fwO=length(fwidth(d));
  vec3 nO=normalize(hit/uRadii*uRadii.x);       // ellipsoid normal (object space)
  vec3 N=R*nO, L=uSunDir;
  vec3 P=R*(hit*uRadii);
  vec3 V=normalize(uCamRel-P);
  float lat=asin(clamp(nO.z,-1.,1.)), lon=atan(nO.y,nO.x);
  vec3 col=vec3(0.5); float lim=1.0;
  float mu0=dot(N,L), mv=max(dot(N,V),0.);
  float lit=pow(clamp((mu0+0.09)/1.09,0.,1.),1.2);
  vec3 night=vec3(0.);
  float spec=0.;

  if(uMode==0){ // Jupiter: Cassini map + procedural fine cloud structure
    vec2 uv=vec2(lon/(2.*PI)+0.5, 0.52+lat/PI*0.94);
    col=texWrap(uMap,uv).rgb;
    float bandMask=0.5+0.5*sin(lat*37.);
    float f1=zonal(d,6.,260.,fwO,6,1.3), f2=zonal(d,18.,900.,fwO,5,4.1);
    col*=1.+0.55*(f1-0.5)*(0.5+bandMask*0.5)+0.35*(f2-0.5);
    col=satur(col,1.12);
    lim=mix(0.5,1.,pow(mv,0.45));
  } else if(uMode==1){ // Saturn
    float v=0.5+lat/PI; vec3 base=texture2D(uRamp,vec2(0.5,v)).rgb;
    float stripes=0.5+0.5*sin(lat*95.+3.*(zonal(d,3.,40.,fwO,3,2.)-0.5));
    float f1=zonal(d,5.,300.,fwO,6,1.1), f2=zonal(d,14.,800.,fwO,5,3.3);
    col=base*(0.86+0.2*stripes)*(1.+0.4*(f1-0.5)+0.3*(f2-0.5));
    col=satur(col,1.25)*vec3(1.02,0.97,0.88);
    float hex=smoothstep(0.02,0.0,abs(lat-1.37+0.012*cos(6.*lon)));  // north polar hexagon
    col*=1.-0.18*hex;
    lim=mix(0.55,1.,pow(mv,0.45));
  } else if(uMode==2){ // Uranus: nearly featureless methane haze
    float v=0.5+lat/PI; vec3 base=texture2D(uRamp,vec2(0.5,v)).rgb;
    float f1=zonal(d,4.,60.,fwO,4,0.7);
    col=base*vec3(0.80,0.98,1.02)*(1.+0.05*(f1-0.5));
    col=mix(col,vec3(0.72,0.92,0.95),smoothstep(0.9,1.5,-lat)*0.35); // brighter sunlit south pole
    lim=mix(0.62,1.,pow(mv,0.4));
  } else if(uMode==3){ // Neptune
    float v=0.5+lat/PI; vec3 base=texture2D(uRamp,vec2(0.5,v)).rgb;
    float f1=zonal(d,4.,38.,fwO,6,2.2), f2=zonal(d,9.,110.,fwO,5,5.);
    float bnd=0.5+0.5*sin(lat*22.+2.*(f1-0.5));
    col=base*vec3(0.55,0.72,1.12)*(0.82+0.18*bnd)*(0.95+0.45*(f1-0.5)+0.35*(f2-0.5));
    // Great Dark Spot (22S) + companion, Scooter (42S) and small dark spot (55S)
    float la=lat*180./PI, lo=lon*180./PI;
    vec2 gds=vec2((lo-10.)/22.,(la+22.)/9.);  float g=exp(-dot(gds,gds)*1.8);
    col*=1.-0.55*g; col+=vec3(0.7,0.75,0.9)*0.5*exp(-pow(length(vec2((lo-45.)/18.,(la+27.)/3.)),2.));
    vec2 sc=vec2((lo+95.)/10.,(la+42.)/4.); col+=vec3(0.8,0.85,1.)*0.55*exp(-dot(sc,sc)*1.5);
    vec2 sd=vec2((lo-150.)/9.,(la+55.)/5.); col*=1.-0.35*exp(-dot(sd,sd)*1.6);
    float cir=zonal(d,9.,700.,fwO,4,9.); col+=vec3(0.75,0.82,0.95)*0.55*smoothstep(0.62,0.8,cir)*smoothstep(-0.9,-0.35,-abs(la+30.)/25.+0.2); // high cirrus streaks
    lim=mix(0.55,1.,pow(mv,0.45));
  } else if(uMode==4){ // Earth
    vec2 uv=vec2(lon/(2.*PI)+0.5, 0.5+lat/PI);
    vec3 day=texWrap(uMap,uv).rgb; float cl=texWrap(uMap2,vec2(fract(uv.x+uTime*0.0002),uv.y)).a;
    float sp=texWrap(uMap3,uv).r; vec3 lights=texWrap(uMap4,uv).rgb;
    col=mix(day,vec3(0.95),cl*0.92);
    spec=sp*(1.-cl)*pow(max(dot(reflect(-L,N),V),0.),55.)*1.1;
    night=lights*(1.-cl*0.8)*smoothstep(0.05,-0.15,mu0)*0.9;
    lit=clamp(mu0*1.08+0.04,0.,1.)*smoothstep(-0.06,0.1,mu0)+clamp(mu0,0.,1.)*0.0;
    lit=smoothstep(-0.07,0.18,mu0)*clamp(mu0*0.85+0.2,0.,1.);
  } else { // plain textured (Moon): Lommel-Seeliger
    vec2 uv=vec2(lon/(2.*PI)+0.5, 0.5+lat/PI);
    col=texWrap(uMap,uv).rgb*1.5;
    lit=mu0>0.?mu0/(mu0+max(mv,0.05))*1.9:0.;
  }

  vec3 pObj=hit*uRadii;  // body frame
  float vis=occlusion(P);
  float rs=ringShadow(pObj, transpose(R)*L);
  vec3 rad=col*lim*lit*vis*rs*uIrr*${SUN_K};
  rad+=vec3(spec)*vis*uIrr*${SUN_K};
  rad+=night*0.5;
  rad+=col*0.004;   // ring/space shine floor
  gl_FragColor=vec4(rad,cov);
}`;

// ---------------------------------------------------------------------------------------------
// Moons: procedural surfaces
const _MOON_FS = LOGDEPTH_FS_PARS + NOISE + OCCLUDE + BODY_UNIFORMS + /* glsl */ `
uniform int uType; uniform float uSeed; uniform vec3 uColA,uColB; uniform float uDens; uniform float uBump;
uniform vec3 uParentDir; uniform float uShine;
// crater height (x) and fresh-ejecta brightness (y)
vec2 craters(vec3 p, float s, float dens, float fwu){
  vec3 q=p*s, ip=floor(q), fp=q-ip; float h=0., br=0.;
  float fade0=0.;
  for(int k=0;k<27;k++){
    vec3 g=vec3(float(k%3)-1., float((k/3)%3)-1., float(k/9)-1.);
    vec3 id=ip+g; vec3 r=hash33(id+uSeed);
    if(r.x>dens) continue;
    vec3 c=g+0.18+0.64*hash33(id*1.7+uSeed+7.3)-fp;
    float rad=0.09+0.32*r.y*r.y;
    float d=length(c)/rad;
    float fade=smoothstep(0.9,3.0,(rad/s)/max(fwu,1e-6));
    float bowl=d<1.?-(1.-d*d):0.; float rim=exp(-pow((d-1.)*3.2,2.))*0.45;
    float peak=(rad>0.3)?exp(-d*d*30.)*0.6:0.;
    h+=(bowl*0.85+rim+peak)*rad*fade/s*0.28;
    br+=r.z*exp(-pow(max(d-0.7,0.)*0.9,2.))*fade*step(0.55,r.z);
  }
  return vec2(h,br);
}
float ridged(vec3 p,float fw){ return 1.-abs(2.*fbm(p,fw,3)-1.); }
vec3 satur(vec3 c,float s){ float l=dot(c,vec3(.299,.587,.114)); return mix(vec3(l),c,s); }
void main(){
${ANALYTIC}
  vec3 d=hit;
  float fw=length(fwidth(d));
  vec3 nO=normalize(hit/uRadii*uRadii.x);
  vec3 N=R*nO, L=uSunDir;
  vec3 P=R*(hit*uRadii);
  vec3 V=normalize(uCamRel-P);
  float lat=asin(clamp(nO.z,-1.,1.)), lon=atan(nO.y,nO.x);
  vec3 col=uColA; float h=0.; float rough=1.; float wrap=0.; vec3 haze=vec3(0.);
  vec2 c1,c2,c3;

  if(uType==1){ // Io
    float n1=fbm(d*3.,fw*3.,5), n2=fbm(d*9.+4.,fw*9.,5), n3=fbm(d*28.+2.,fw*28.,4);
    col=mix(vec3(0.85,0.7,0.16),vec3(0.92,0.46,0.07),smoothstep(0.45,0.7,n1));
    col=mix(col,vec3(0.86,0.84,0.74),smoothstep(0.56,0.75,n2)*0.85);
    col=mix(col,vec3(0.6,0.28,0.12),smoothstep(0.6,0.78,fbm(d*5.+9.,fw*5.,4))*0.75);
    col=mix(col,vec3(0.5,0.34,0.17),smoothstep(0.55,0.95,abs(d.z))*0.55);
    col*=0.85+0.3*n3;
    // volcanic centres: dark calderas with red/orange halos
    vec3 q=d*11.; vec3 ip=floor(q); float spot=0., halo=0.;
    for(int k=0;k<27;k++){ vec3 g=vec3(float(k%3)-1.,float((k/3)%3)-1.,float(k/9)-1.); vec3 id=ip+g; vec3 r=hash33(id+uSeed);
      if(r.x>0.2) continue; vec3 c=g+0.2+0.6*hash33(id*2.3+1.7)-(q-ip); float dd=length(c);
      spot+=smoothstep(0.16+0.07*r.y,0.05,dd); halo+=smoothstep(0.55,0.12,dd)*r.z; }
    col=mix(col,vec3(0.85,0.32,0.1),clamp(halo,0.,1.)*0.55);
    col=mix(col,vec3(0.025,0.02,0.02),clamp(spot,0.,1.));
    vec3 pele=normalize(vec3(0.62,-0.55,-0.25)); float ap=acos(clamp(dot(d,pele),-1.,1.))*(0.8+0.5*fbm(d*14.,fw*14.,3));
    col=mix(col,vec3(0.8,0.24,0.08),smoothstep(0.2,0.12,ap)*smoothstep(0.03,0.09,ap)*0.55);
    c1=craters(d,5.,0.04,fw); h=c1.x*0.5+0.004*(fbm(d*14.,fw*14.,4)-0.5)+0.01*(n1-0.5);
    wrap=0.05;
  } else if(uType==2){ // Europa
    float n1=fbm(d*3.,fw*3.,5), n2=fbm(d*8.+11.,fw*8.,5);
    col=mix(vec3(0.88,0.87,0.82),vec3(0.8,0.82,0.84),n1);
    float ln=0.;
    for(int i=0;i<3;i++){ float s=3.+float(i)*3.7; float w=fbm(d*s+float(i)*5.1,fw*s,4); ln+=smoothstep(0.028,0.0,abs(w-0.5))*(0.9-0.2*float(i)); }
    col=mix(col,vec3(0.58,0.34,0.2),clamp(ln,0.,1.)*0.8);
    col=mix(col,vec3(0.6,0.42,0.3),smoothstep(0.66,0.8,fbm(d*3.2+21.,fw*3.2,5))*0.5);   // chaos terrain
    col=mix(col,vec3(0.7,0.55,0.4),smoothstep(0.5,0.9,abs(d.z))*0.15);
    c1=craters(d,9.,0.06,fw); h=c1.x*0.4; col=mix(col,vec3(0.97),clamp(c1.y,0.,1.)*0.6);
  } else if(uType==3){ // Ganymede
    float n1=fbm(d*2.4,fw*2.4,5), n2=fbm(d*7.+3.,fw*7.,5);
    float lightT=smoothstep(0.42,0.56,n1+0.18*(n2-0.5));
    vec3 dark=vec3(0.15,0.13,0.11), light=vec3(0.42,0.395,0.36);
    col=mix(dark,light,lightT);
    float gr=sin(fbm(d*3.+8.,fw*3.,3)*70.)*(1.-ss(0.4,1.6,fw*70.)); col*=1.+0.08*gr*lightT;
    col*=0.9+0.2*n2;
    c1=craters(d,5.,0.5,fw); c2=craters(d,16.,0.7,fw); c3=craters(d,48.,0.8,fw);
    h=c1.x+c2.x*0.8+c3.x*0.5;
    col=mix(col,vec3(0.88,0.88,0.86),clamp(c1.y+c2.y+c3.y,0.,1.)*0.85);
    col=mix(col,vec3(0.8,0.82,0.85),smoothstep(0.75,1.,abs(d.z))*0.6);
  } else if(uType==4){ // Callisto
    float n1=fbm(d*3.,fw*3.,5), n2=fbm(d*11.,fw*11.,5);
    col=mix(vec3(0.11,0.095,0.082),vec3(0.17,0.145,0.12),n1)*(0.85+0.3*n2);
    c1=craters(d,4.,0.95,fw); c2=craters(d,13.,1.,fw); c3=craters(d,40.,1.,fw);
    h=c1.x+c2.x+c3.x*0.8;
    col=mix(col,vec3(0.75,0.75,0.72),clamp(c1.y+c2.y+c3.y,0.,1.)*0.9);
    vec3 val=normalize(vec3(0.3,-0.85,0.2)); float a=acos(clamp(dot(d,val),-1.,1.));
    col=mix(col,vec3(0.62,0.6,0.56),(smoothstep(0.1,0.04,a)*0.8+smoothstep(0.55,0.2,a)*(0.35+0.35*sin(a*70.)))*smoothstep(0.62,0.5,a));
  } else if(uType==5){ // Titan: opaque orange haze
    float n1=zonal(d,3.,8.,fw,4,1.), n2=fbm(d*5.,fw*5.,4);
    col=mix(vec3(0.78,0.47,0.14),vec3(0.93,0.62,0.22),n1);
    col*=0.92+0.12*n2;
    col=mix(col,vec3(0.5,0.34,0.12),smoothstep(0.9,1.3,lat)*0.7);       // dark north polar hood
    col=mix(col,vec3(0.95,0.66,0.26),smoothstep(0.12,0.0,abs(lat+0.1))*0.2);
    wrap=0.28; rough=0.;
  } else if(uType==6){ // Triton
    float n1=fbm(d*3.,fw*3.,5), n2=fbm(d*9.+2.,fw*9.,5);
    col=mix(vec3(0.88,0.82,0.76),vec3(0.78,0.84,0.8),smoothstep(0.4,0.6,n1));
    float cap=smoothstep(-0.05,-0.55,lat+0.1*(n2-0.5));
    col=mix(col,vec3(0.96,0.78,0.7),cap*0.9);
    float st=zonal(d,2.,4.,fw,4,7.), st2=zonal(d,14.,22.,fw,4,8.);
    col*=1.-0.5*smoothstep(0.62,0.78,st2)*cap*step(0.4,st);       // dark geyser streaks
    col=mix(col,vec3(0.5,0.58,0.55),smoothstep(0.3,0.5,fbm(d*4.+30.,fw*4.,5))*(1.-cap)*0.35);
    // cantaloupe terrain: closely packed dimples
    vec3 q=d*26.; vec3 ip=floor(q); float cell=9.;
    for(int k=0;k<27;k++){ vec3 g=vec3(float(k%3)-1.,float((k/3)%3)-1.,float(k/9)-1.); vec3 pp=g+hash33(ip+g+uSeed)-(q-ip); cell=min(cell,dot(pp,pp)); }
    float dimple=smoothstep(0.,0.45,sqrt(cell))*smoothstep(0.7,0.2,fw*26.);
    h=-0.0035*(1.-dimple)*(1.-cap*0.6)+0.004*(n1-0.5); col*=0.93+0.1*dimple;
    c1=craters(d,10.,0.08,fw); h+=c1.x*0.3;
    wrap=0.12;
  } else if(uType==7){ // Iapetus: two-tone
    float n=fbm(d*4.,fw*4.,5);
    float t=smoothstep(-0.2,0.2,cos(lon-2.0)*0.9+(n-0.5)*0.9+0.1*d.z*d.z);
    col=mix(vec3(0.82,0.8,0.74),vec3(0.055,0.045,0.04),t);
    c1=craters(d,6.,0.7,fw); c2=craters(d,20.,0.9,fw); h=c1.x+c2.x*0.8;
    col=mix(col,vec3(0.85),clamp(c1.y+c2.y,0.,1.)*0.5*t);
  } else if(uType==8){ // Enceladus
    float n=fbm(d*5.,fw*5.,5);
    col=vec3(0.97,0.98,1.0)*(0.93+0.1*n);
    float ln=0.; for(int i=0;i<2;i++){ float s=6.+float(i)*5.; ln+=smoothstep(0.04,0.0,abs(fbm(d*s+float(i)*3.,fw*s,4)-0.5)); }
    col=mix(col,vec3(0.78,0.85,0.92),clamp(ln,0.,1.)*0.6);
    col=mix(col,vec3(0.75,0.88,0.95),smoothstep(-1.0,-1.35,lat)*0.5);
    c1=craters(d,7.,0.45,fw); c2=craters(d,24.,0.3,fw); h=c1.x*0.7+c2.x*0.5+0.002*ln;
  } else if(uType==9){ // Miranda: patchwork terrains
    float n=fbm(d*2.5,fw*2.5,5), n2=fbm(d*6.+5.,fw*6.,5);
    float cor=smoothstep(0.5,0.6,n);
    float stripes=0.5+0.5*sin((fbm(d*3.+8.,fw*3.,4)*30.)+lat*35.);
    col=mix(vec3(0.5,0.5,0.52),vec3(0.62,0.62,0.64),stripes)*mix(1.,0.72,cor)*(0.85+0.3*n2);
    col=mix(col,vec3(0.78,0.78,0.8),smoothstep(0.65,0.8,n2)*0.5);
    c1=craters(d,6.,0.6,fw); c2=craters(d,22.,0.8,fw); h=c1.x*0.8+c2.x*0.6+0.012*(n-0.5)+0.003*stripes*cor;
    col=mix(col,vec3(0.85),clamp(c1.y,0.,1.)*0.5);
  } else if(uType==10){ // Mimas (with Herschel)
    col=vec3(0.6,0.6,0.61)*(0.9+0.2*fbm(d*5.,fw*5.,4));
    c1=craters(d,5.,0.95,fw); c2=craters(d,16.,1.,fw); c3=craters(d,50.,1.,fw); h=c1.x+c2.x+c3.x*0.7;
    vec3 hc=normalize(vec3(-0.15,0.97,0.15)); float a=acos(clamp(dot(d,hc),-1.,1.)); float dd=a/0.55;
    h+=(dd<1.?-(1.-dd*dd)*0.25:0.)+exp(-pow((dd-1.)*3.,2.))*0.07+exp(-dd*dd*45.)*0.1;
    col=mix(col,vec3(0.82),clamp(c1.y+c2.y,0.,1.)*0.5);
  } else if(uType==11){ // Dione / generic wispy ice
    float n=fbm(d*3.,fw*3.,5); float wisp=smoothstep(0.55,0.75,zonal(d,2.,5.,fw,4,2.));
    col=mix(vec3(0.62,0.62,0.6),vec3(0.78,0.78,0.78),n)*(1.+0.35*wisp);
    c1=craters(d,5.,0.8,fw); c2=craters(d,17.,0.95,fw); c3=craters(d,50.,1.,fw); h=c1.x+c2.x+c3.x*0.7;
    col=mix(col,vec3(0.92),clamp(c1.y+c2.y,0.,1.)*0.6);
  } else if(uType==12){ // Ariel / Umbriel / Titania / Oberon
    float n=fbm(d*3.,fw*3.,5);
    col=mix(uColA,uColB,n)*(0.88+0.25*fbm(d*10.,fw*10.,4));
    float gv=ridged(d*3.,fw*3.); h+=0.004*smoothstep(0.8,0.95,gv); col*=1.+0.2*smoothstep(0.82,0.95,gv);
    c1=craters(d,6.,0.7,fw); c2=craters(d,20.,0.9,fw); c3=craters(d,60.,1.,fw); h+=c1.x+c2.x+c3.x*0.7;
    col=mix(col,vec3(0.9),clamp(c1.y+c2.y,0.,1.)*0.55);
  } else if(uType==13){ // small irregular dark bodies (Amalthea, Hyperion, Proteus, Nereid)
    float n=fbm(d*3.,fw*3.,5);
    col=mix(uColA,uColB,n);
    c1=craters(d,4.,1.,fw); c2=craters(d,12.,1.,fw); c3=craters(d,36.,1.,fw); h=c1.x+c2.x+c3.x*0.9;
    col=mix(col,col*1.9,clamp(c1.y+c2.y,0.,1.)*0.5);
  } else { // generic cratered ice/rock
    float n=fbm(d*3.,fw*3.,5);
    col=mix(uColA,uColB,n);
    c1=craters(d,5.,0.8,fw); c2=craters(d,17.,0.95,fw); c3=craters(d,50.,1.,fw); h=c1.x+c2.x+c3.x*0.7;
    col=mix(col,vec3(0.9),clamp(c1.y+c2.y,0.,1.)*0.5);
  }

  // bump mapping from the height field (units: fraction of radius)
  vec3 dpx=dFdx(P), dpy=dFdy(P); float hk=h*uRadii.x*uBump*0.65;
  float dhx=dFdx(hk), dhy=dFdy(hk); vec3 r1=cross(dpy,N), r2=cross(N,dpx); float det=dot(dpx,r1);
  vec3 grad=sign(det)*(dhx*r1+dhy*r2);
  vec3 Nb=normalize(abs(det)*N-grad*rough);
  float mu0=dot(Nb,L), muG=dot(N,L), mv=max(dot(N,V),0.05);
  // Lommel-Seeliger with an opposition surge
  float ls=max(mu0,0.)/(max(mu0,0.)+mv)*2.0;
  float lam=max((mu0+wrap)/(1.+wrap),0.);
  float lit=mix(ls,lam,step(0.01,wrap)*0.8+0.2*step(0.01,wrap));
  lit*=smoothstep(-0.02,0.03,muG);
  float vis=occlusion(P);
  vec3 rad=col*uIrr*${SUN_K}*lit*vis;
  rad+=col*uShine*max(dot(N,uParentDir),0.);       // reflected light from the parent planet
  rad+=col*0.003;
  gl_FragColor=vec4(rad,cov);
}`;

// ---------------------------------------------------------------------------------------------
// Ring plane
export const RING_VS = LOGDEPTH_VS_PARS + /* glsl */ `
varying vec3 vObj;
void main(){ vObj=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
#include <logdepthbuf_vertex>
}`;
const _RING_FS = LOGDEPTH_FS_PARS + NOISE + OCCLUDE + RING + /* glsl */ `
uniform vec3 uAx,uAy,uAz,uCamRel; uniform float uIrr, uRingOuter, uRingInner;
varying vec3 vObj;
void main(){
#include <logdepthbuf_fragment>
  vec2 loc=vObj.xy*uRingOuter; float r=length(loc)/uRingR; float fwr=fwidth(r);
  vec3 col; float tau=ringTau(r,fwr,col);
  if(r<uRingInner/uRingR || r>uRingOuter/uRingR || tau<1e-5) discard;
  mat3 R=mat3(uAx,uAy,uAz); vec3 P=R*vec3(loc,0.);
  vec3 n=uAz, V=normalize(uCamRel-P), L=uSunDir;
  float mus=max(abs(dot(n,L)),0.02), muv=max(abs(dot(n,V)),0.02);
  bool same=dot(n,L)*dot(n,V)>0.;
  float a=1./mus, b=1./muv, alpha=1.-exp(-tau*b);
  vec3 rad;
  if(same){ rad=col*0.95*mus/(mus+muv)*(1.-exp(-tau*(a+b)))*${SUN_K}*1.9; }
  else {
    float tr=abs(a-b)<1e-3 ? tau*exp(-tau*a) : (exp(-tau*a)-exp(-tau*b))/(b-a);
    rad=col*tr*${SUN_K}*1.4;
  }
  // forward-scatter glow when looking almost into the sun through the rings
  float cs=dot(-V,L); rad*=1.+1.2*pow(max(cs,0.),12.)*(same?0.:1.);
  rad*=occlusion(P)*uIrr;
  rad+=col*0.002*alpha;
  gl_FragColor=vec4(rad,alpha);
}`;

// ---------------------------------------------------------------------------------------------
// Atmosphere shell (thin scattering layer); mesh is a unit sphere scaled to the outer radius
export const ATMO_VS = LOGDEPTH_VS_PARS + /* glsl */ `
varying vec3 vDir;
void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
#include <logdepthbuf_vertex>
}`;
export const ATMO_FS = LOGDEPTH_FS_PARS + /* glsl */ `
uniform vec3 uCamRel, uSunDir, uColor; uniform float uPlanetR, uShellR, uScaleH, uKappa, uIrr, uMie, uG, uSunAng;
varying vec3 vDir;
float phaseHG(float c,float g){ float g2=g*g; return (1.-g2)/pow(1.+g2-2.*g*c,1.5)/(4.*3.14159); }
void main(){
#include <logdepthbuf_fragment>
  vec3 P=vDir*uShellR; vec3 rd=normalize(P-uCamRel);
  // intersect view ray with the outer shell (we are on its front face) and with the planet
  float b=dot(uCamRel,rd); float c=dot(uCamRel,uCamRel)-uShellR*uShellR;
  float disc=b*b-c; if(disc<=0.) discard;
  float t0=-b-sqrt(disc), t1=-b+sqrt(disc);
  float cp=dot(uCamRel,uCamRel)-uPlanetR*uPlanetR, dp=b*b-cp;
  if(dp>0. && -b-sqrt(dp)>0.) t1=min(t1,-b-sqrt(dp));
  float seg=max(t1-t0,0.);
  vec3 acc=vec3(0.); float step_=seg/8.; float tau=0.;
  for(int i=0;i<8;i++){
    vec3 p=uCamRel+rd*(t0+(float(i)+0.5)*step_);
    float h=max(length(p)-uPlanetR,0.); float dens=exp(-h/uScaleH);
    float mu=dot(normalize(p),uSunDir);
    float horizon=-sqrt(max(1.-(uPlanetR*uPlanetR)/dot(p,p),0.));
    float sunVis=smoothstep(horizon-0.12,horizon+0.12,mu);
    float cs=dot(rd,uSunDir);
    float ph=0.75*(1.+cs*cs)*0.0795+uMie*phaseHG(cs,uG);
    acc+=uColor*dens*step_*uKappa*sunVis*ph*exp(-tau);
    tau+=dens*step_*uKappa*0.3;
  }
  gl_FragColor=vec4(acc*uIrr*${SUN_K}*12.,1.);
}`;

// ---------------------------------------------------------------------------------------------
export const SUN_FS = LOGDEPTH_FS_PARS + /* glsl */ `
uniform float uBright; varying vec3 vObj;
void main(){
#include <logdepthbuf_fragment>
  gl_FragColor=vec4(vec3(1.0,0.93,0.8)*uBright,1.);
}`;
// ---------------------------------------------------------------------------------------------
// Point sprites: stars (at infinity) and unresolved bodies
export const STAR_VS = /* glsl */ `
attribute float aMag; attribute vec3 aCol;
uniform float uGain, uPx, uExp; uniform mat3 uViewRot; uniform mat4 uProj;
varying vec3 vCol; varying float vI;
void main(){
  vec4 p=uProj*vec4(uViewRot*position,1.0); p.z=p.w*0.999999; gl_Position=p;
  float I=min(pow(10.,-0.4*(aMag-6.4)),5.)*uGain; vCol=aCol; vI=I;
  float sz=1.8+2.4*log2(1.+I*1.5);
  gl_PointSize=clamp(sz*uPx,1.5,160.);
}`;
export const STAR_FS = /* glsl */ `
varying vec3 vCol; varying float vI;
void main(){
  vec2 q=(gl_PointCoord-0.5)*2.; float r2=dot(q,q); if(r2>1.) discard;
  float wnd=(1.-r2)*(1.-r2);
  float core=exp(-r2*9.), halo=exp(-r2*3.5)*0.05*(1.+vI*0.6)*wnd;
  float spike=0.;
  if(vI>6.){ float s=1./(1.+abs(q.x*q.y)*60.); spike=0.05*s*exp(-r2*1.5)*log2(vI); }
  gl_FragColor=vec4(vCol*vI*(core+halo+spike),1.);
}`;

export const SPRITE_VS = LOGDEPTH_VS_PARS + /* glsl */ `
attribute vec4 aData; attribute vec3 aCol; uniform float uPx;
varying vec3 vCol; varying float vI;
void main(){
  vCol=aCol; vI=aData.x;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
  gl_PointSize=clamp((1.8+2.4*log2(1.+vI*1.5))*uPx*aData.y,1.,200.);
  if(aData.x<=0.001) gl_Position=vec4(2.,2.,2.,1.);
#include <logdepthbuf_vertex>
}`;
export const SPRITE_FS = LOGDEPTH_FS_PARS + /* glsl */ `
varying vec3 vCol; varying float vI;
void main(){
#include <logdepthbuf_fragment>
  vec2 q=(gl_PointCoord-0.5)*2.; float r2=dot(q,q); if(r2>1.) discard;
  float wnd=(1.-r2)*(1.-r2);
  float core=exp(-r2*9.), halo=exp(-r2*3.5)*0.07*wnd;
  gl_FragColor=vec4(vCol*vI*(core+halo),1.);
}`;

// Milky Way background
export const MW_VS = /* glsl */ `
varying vec3 vDir; uniform mat3 uViewRot; uniform mat4 uProj;
void main(){ vDir=position; vec4 p=uProj*vec4(uViewRot*position,1.0); p.z=p.w*0.9999995; gl_Position=p; }`;
export const MW_FS = /* glsl */ `
uniform sampler2D uTex; uniform float uGain, uRef; varying vec3 vDir;
float h(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
void main(){
  vec3 d=normalize(vDir);
  vec2 uv=vec2(atan(d.y,d.x)/(2.*3.14159265)+0.0, 0.5+asin(clamp(d.z,-1.,1.))/3.14159265);
  uv.x=fract(uv.x);
  vec3 c=pow(texture2D(uTex,uv).rgb,vec3(2.2))*uRef;
  float g=h(floor(d*3000.)); c*=0.9+0.2*g;           // unresolved-star graininess
  gl_FragColor=vec4(c*uGain,1.);
}`;

// Camera artefacts: vignette, slight chromatic fringe, sensor grain
export const LENS_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 }, uAspect: { value: 1.7 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse; uniform float uTime, uFade; varying vec2 vUv;
float h(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
void main(){
  vec2 c=vUv-0.5; float r2=dot(c,c);
  vec2 off=c*r2*0.0035;
  vec3 col=vec3(texture2D(tDiffuse,vUv+off).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-off).b);
  col*=1.-0.55*smoothstep(0.1,0.62,r2);
  float g=h(vUv*1000.+uTime)-0.5; col+=g*0.018*(1.-0.5*dot(col,vec3(.33)));
  gl_FragColor=vec4(col*uFade,1.);
}`,
};

const fixSS = (x) => x.replace(/\bsmoothstep\(/g, 'ss(');
export const PLANET_FS = fixSS(_PLANET_FS);
export const MOON_FS = fixSS(_MOON_FS);
export const RING_FS = fixSS(_RING_FS);
