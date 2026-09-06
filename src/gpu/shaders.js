export const COMMON = /* wgsl */ `
struct Uniforms {
  frame: vec4f,
  p0: vec4f,
  p1: vec4f,
  p2: vec4f,
  c0: vec4f,
  c1: vec4f,
  aux: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var srcA: texture_2d<f32>;
@group(0) @binding(3) var srcB: texture_2d<f32>;
struct Varying { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn fullscreen(@builtin(vertex_index) i: u32) -> Varying {
  let points = array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
  var out: Varying;
  out.position = vec4f(points[i],0.0,1.0);
  out.uv = points[i] * vec2f(0.5,-0.5) + 0.5;
  return out;
}
fn hash21(p:vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
fn noise2(p:vec2f) -> f32 {
  let i=floor(p); let f=fract(p); let v=f*f*(3.0-2.0*f);
  return mix(mix(hash21(i),hash21(i+vec2f(1,0)),v.x),mix(hash21(i+vec2f(0,1)),hash21(i+vec2f(1,1)),v.x),v.y);
}
fn fbm(p0:vec2f) -> f32 {
  var p=p0; var a=0.5; var value=0.0;
  for(var i=0;i<7;i++){if(f32(i)>=u.p0.y){break;}value+=a*noise2(p);p=mat2x2f(0.8,-0.6,0.6,0.8)*p*2.03+vec2f(1.7,9.2);a*=0.5;}
  return value;
}
fn palette(t:f32) -> vec3f {return 0.5+0.5*cos(6.2831853*(vec3f(0.95,0.75,0.68)*t+vec3f(0.1,0.34,0.52)));}
fn rotate2(p:vec2f,a:f32)->vec2f {let c=cos(a);let s=sin(a);return mat2x2f(c,s,-s,c)*p;}
fn luminance(c:vec3f)->f32{return dot(c,vec3f(0.2126,0.7152,0.0722));}
fn sampleA(uv:vec2f)->vec4f{return textureSample(srcA,samp,uv);}
fn sampleB(uv:vec2f)->vec4f{return textureSample(srcB,samp,uv);}
`;
export const FRAGMENT_ENTRY = `\n@fragment fn fragmentMain(input:Varying) -> @location(0) vec4f { return effect(input.uv); }\n`;
export const EFFECTS = {
    copy: `fn effect(uv:vec2f)->vec4f{return sampleA(uv);}`,
    noise: `fn effect(uv:vec2f)->vec4f {
  let t=u.frame.z*u.p0.z;let aspect=u.frame.x/u.frame.y;
  let p=(uv-0.5)*vec2f(aspect,1.0)*u.p0.x+u.p1.z*0.11;
  let q=vec2f(fbm(p+vec2f(0.0,t*.24)),fbm(p+vec2f(5.2,1.3)-t*.18));
  let r=vec2f(fbm(p+u.p0.w*q+vec2f(1.7,9.2)+t*.13),fbm(p+u.p0.w*q+vec2f(8.3,2.8)-t*.11));
  let f=fbm(p+u.p0.w*r+q*.8);
  let band=.5+.5*sin(f*32.0+q.x*7.0);
  var col=mix(vec3f(.025,.07,.18),vec3f(.12,.85,.73),smoothstep(.18,.48,f));
  col=mix(col,vec3f(.65,.22,.91),smoothstep(.47,.72,f));
  col=mix(col,vec3f(.98,.47,.25),smoothstep(.68,.86,f));
  col*=.8+.2*sin(q.x*14.+r.y*8.);
  if(u.p1.y>0.5&&u.p1.y<1.5){col=mix(vec3f(.07,.012,.09),vec3f(1.,.54,.18),pow(f,1.4));}
  if(u.p1.y>1.5&&u.p1.y<2.5){col=mix(vec3f(.02,.055,.14),vec3f(.3,1.,.87),f);}
  if(u.p1.y>2.5){col=vec3f(f);}
  col*=.32+1.0*smoothstep(.05,.95,band);
  col+=vec3f(.22,.2,.28)*pow(band,14.0)*.6;
  col=pow(max(col,vec3f(0)),vec3f(u.p1.x));
  return vec4f(col,1.0);
 }`,
    ramp: `fn effect(uv:vec2f)->vec4f{let p=rotate2(uv-.5,u.p0.x);var t=fract((p.x+.5)*u.p0.y);if(u.p0.z>0.5&&u.p0.z<1.5){t=fract(length(p)*2.*u.p0.y);}if(u.p0.z>1.5){t=fract(atan2(p.y,p.x)/6.2831853*u.p0.y+.5);}return mix(u.c0,u.c1,t);}`,
    constant: `fn effect(uv:vec2f)->vec4f{return u.c0;}`,
    checker: `fn effect(uv:vec2f)->vec4f{let i=floor(uv*u.p0.x);return mix(u.c0,u.c1,(i.x+i.y)%2.0);}`,
    shape: `fn effect(uv:vec2f)->vec4f{let p=rotate2((uv-.5)*vec2f(u.frame.x/u.frame.y,1),u.p0.w);var d=length(p);if(u.p1.x>.5&&u.p1.x<1.5){let a=atan2(p.y,p.x);let sector=6.2831853/u.p0.z;d=cos(floor(.5+a/sector)*sector-a)*length(p);}var mask=1.-smoothstep(u.p0.x-u.p0.y,u.p0.x+u.p0.y,d);if(u.p1.x>1.5){mask*=smoothstep(u.p0.x*.8-u.p0.y,u.p0.x*.8+u.p0.y,d);}return vec4f(u.c0.rgb*mask,1);}`,
    transform: `fn effect(uv:vec2f)->vec4f{let p=rotate2((uv-.5-vec2f(u.p0.z,u.p0.w))/u.p0.x,-u.p0.y)+.5;return sampleA(p);}`,
    displace: `fn effect(uv:vec2f)->vec4f{let d=sampleB(uv*u.p0.y).rg-.5;return sampleA(uv+d*u.p0.x*(1.+u.aux.y*.4));}`,
    kaleido: `fn effect(uv:vec2f)->vec4f{let aspect=u.frame.x/u.frame.y;let p=(uv-.5-vec2f(u.p0.w,u.p1.x))*vec2f(aspect,1.);let sector=6.2831853/max(1.,u.p0.x);var a=atan2(p.y,p.x)+u.p0.y;a=abs(fract(a/sector+.5)*sector-sector*.5);let q=vec2f(cos(a),sin(a))*length(p)/u.p0.z/vec2f(aspect,1.)+.5;return sampleA(q);}`,
    blur: `fn effect(uv:vec2f)->vec4f{var col=sampleA(uv)*.2;for(var i=0;i<12;i++){let a=f32(i)*6.2831853/12.;let r=select(.45,1.,i%2==0);col+=sampleA(uv+vec2f(cos(a),sin(a))*u.p0.x*r/u.frame.xy)*(.8/12.);}return col;}`,
    bloom: `fn effect(uv:vec2f)->vec4f{let base=sampleA(uv);var glow=vec3f(0);for(var i=0;i<16;i++){let a=f32(i)*2.399963;let d=sqrt(f32(i)+1.0)*u.p0.y*.25/u.frame.xy;let c=sampleA(uv+vec2f(cos(a),sin(a))*d).rgb;glow+=max(c-vec3f(u.p0.z),vec3f(0));}return vec4f(base.rgb+glow/16.*u.p0.x*(1.+u.aux.y),base.a);}`,
    level: `fn effect(uv:vec2f)->vec4f{let raw=sampleA(uv);var col=max((raw.rgb-.5)*u.p0.y+.5,vec3f(0))*u.p0.x*(1.+u.aux.y*.25);col=pow(col,vec3f(1./u.p0.z));col=mix(vec3f(luminance(col)),col,u.p0.w);if(u.p1.x>.5){col=1.-col;}return vec4f(col,raw.a);}`,
    composite: `fn effect(uv:vec2f)->vec4f{let a=sampleA(uv);let b=sampleB(uv);var c=1.-(1.-a.rgb)*(1.-b.rgb);if(u.p0.x>.5&&u.p0.x<1.5){c=a.rgb+b.rgb;}if(u.p0.x>1.5&&u.p0.x<2.5){c=mix(a.rgb,b.rgb,b.a);}if(u.p0.x>2.5&&u.p0.x<3.5){c=a.rgb*b.rgb;}if(u.p0.x>3.5){c=abs(a.rgb-b.rgb);}return vec4f(mix(a.rgb,c,u.p0.y),1.);}`,
    edge: `fn effect(uv:vec2f)->vec4f{let d=1./u.frame.xy;let tl=luminance(sampleA(uv+vec2f(-d.x,-d.y)).rgb);let tc=luminance(sampleA(uv+vec2f(0,-d.y)).rgb);let tr=luminance(sampleA(uv+vec2f(d.x,-d.y)).rgb);let ml=luminance(sampleA(uv+vec2f(-d.x,0)).rgb);let mr=luminance(sampleA(uv+vec2f(d.x,0)).rgb);let bl=luminance(sampleA(uv+vec2f(-d.x,d.y)).rgb);let bc=luminance(sampleA(uv+vec2f(0,d.y)).rgb);let br=luminance(sampleA(uv+vec2f(d.x,d.y)).rgb);let g=length(vec2f(-tl-2.*ml-bl+tr+2.*mr+br,-tl-2.*tc-tr+bl+2.*bc+br))*u.p0.x;return vec4f(mix(vec3f(g),sampleA(uv).rgb,u.p0.y),1);}`,
    feedback: `fn effect(uv:vec2f)->vec4f{let q=rotate2((uv-.5)/u.p0.y,u.p0.z)+.5;return vec4f(sampleA(q).rgb*u.p0.x,1);}`,
    media: `fn effect(uv:vec2f)->vec4f{var q=uv;let targetAspect=u.frame.x/u.frame.y;let source=u.p0.x/max(1.,u.p0.y);if(u.p0.z<1.5){var scale=vec2f(1.);if((source>targetAspect)==(u.p0.z<.5)){scale.y=source/targetAspect;}else{scale.x=targetAspect/source;}q=(uv-.5)*scale+.5;}if(u.p0.w>.5){q.x=1.-q.x;}let c=sampleA(q);let inBounds=all(q>=vec2f(0))&&all(q<=vec2f(1));return select(vec4f(.015,.018,.025,1),c,inBounds);}`,
    missing: `fn effect(uv:vec2f)->vec4f{let grid=step(.94,fract(uv.x*16.))+step(.94,fract(uv.y*9.));let c=mix(vec3f(.045,.05,.065),vec3f(.10,.11,.14),min(grid,1.));return vec4f(c,1);}`
};
export const PRESENT = /* wgsl */ `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var filterSampler: sampler;
struct V { @builtin(position) position:vec4f, @location(0) uv:vec2f };
@vertex fn vs(@builtin(vertex_index) i:u32)->V{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:V;o.position=vec4f(p[i],0,1);o.uv=p[i]*vec2f(.5,-.5)+.5;return o;}
@fragment fn fs(v:V)->@location(0) vec4f{return vec4f(textureSample(image,filterSampler,v.uv).rgb,1);}
`;
export const MESH = /* wgsl */ `
struct Scene {mvp:mat4x4f,model:mat4x4f,color:vec4f,eye:vec4f,material:vec4f,options:vec4f};
@group(0) @binding(0) var<uniform> scene:Scene;
@group(0) @binding(1) var surface:texture_2d<f32>;
@group(0) @binding(2) var surfaceSampler:sampler;
struct In{@location(0) pos:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f};
struct Out{@builtin(position) pos:vec4f,@location(0) normal:vec3f,@location(1) world:vec3f,@location(2) uv:vec2f};
@vertex fn vs(v:In,@builtin(instance_index) instance:u32)->Out{
 var p=v.pos;
 if(scene.options.x>1.5){let i=f32(instance);let n=scene.options.x;let y=1.-2.*(i+.5)/n;let r=sqrt(1.-y*y);let a=i*2.399963;p=p*.32+vec3f(cos(a)*r,y,sin(a)*r)*scene.options.y;}
 var o:Out;o.pos=scene.mvp*vec4f(p,1);o.world=(scene.model*vec4f(p,1)).xyz;o.normal=normalize((scene.model*vec4f(v.normal,0)).xyz);o.uv=v.uv;return o;
}
@fragment fn fs(v:Out)->@location(0) vec4f{
 let n=normalize(v.normal);let view=normalize(scene.eye.xyz-v.world);let light=normalize(vec3f(-.5,1.,1.));let halfDir=normalize(light+view);
 let tex=textureSample(surface,surfaceSampler,v.uv).rgb;
 let base=mix(scene.color.rgb,tex,scene.options.z);
 let diffuse=max(dot(n,light),0.);let rim=pow(1.-max(dot(n,view),0.),3.);
 let spec=pow(max(dot(n,halfDir),0.),mix(180.,8.,scene.material.y));
 let env=mix(vec3f(.10,.23,.27),vec3f(.65,.48,.9),n.y*.5+.5);
 let color=base*(.14+.75*diffuse)+env*scene.material.x*.55+vec3f(.85,.97,1.)*spec*(.35+scene.material.x)+vec3f(.3,.72,.7)*rim*.65;
 return vec4f(pow(color,vec3f(.85)),1);
}`;
export const PARTICLE_COMPUTE = /* wgsl */ `
struct Uniforms {frame:vec4f,p0:vec4f,p1:vec4f,p2:vec4f,c0:vec4f,c1:vec4f,aux:vec4f};
struct Particle {pos:vec4f,velocity:vec4f};
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read_write> particles:array<Particle>;
fn hash(i:u32)->f32{var n=i;n=(n^61u)^(n>>16u);n=n*9u;n=n^(n>>4u);n=n*0x27d4eb2du;n=n^(n>>15u);return f32(n)/4294967295.;}
@compute @workgroup_size(256) fn update(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;if(i>=u32(u.p0.x)){return;}
 var particle=particles[i];var p=particle.pos.xyz;var life=particle.pos.w;
 let t=u.frame.z;let dt=min(u.frame.w,.05)*u.p0.y;
 if(life<=0.||length(p)>3.||u.aux.w>.5){
  let angle=hash(i*3u+1u)*6.2831853;let r=u.p1.x*(.55+hash(i*3u+2u)*.45);
  p=vec3f(cos(angle)*r,sin(angle)*r,(hash(i*3u+3u)-.5)*.8);life=4.+hash(i+77u)*8.;
 }
 let r=length(p.xy);let flow=vec3f(-p.y,p.x,sin(p.x*3.+t*.2)*.18);
 let curl=vec3f(sin(p.y*4.+p.z*2.+t*.2),cos(p.x*3.-t*.15),sin(p.y*3.-p.x*2.));
 var velocity=flow*.5+curl*u.p0.z*.12-p*(r-u.p1.x)*.6;
 velocity*=1.+u.aux.y*.75;
 p+=velocity*dt;life-=dt;
 particles[i].pos=vec4f(p,life);particles[i].velocity=vec4f(velocity,hash(i+97u));
}`;
export const PARTICLE_RENDER = /* wgsl */ `
struct Uniforms {frame:vec4f,p0:vec4f,p1:vec4f,p2:vec4f,c0:vec4f,c1:vec4f,aux:vec4f};
struct Particle {pos:vec4f,velocity:vec4f};
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> particles:array<Particle>;
struct V{@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) color:vec3f};
@vertex fn vs(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->V{
 let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
 let p=particles[instance];let local=corners[vertex];let aspect=u.frame.x/u.frame.y;let z=1.5+p.pos.z*.22;
 let point=p.pos.xy/z*1.65/vec2f(aspect,1.);let size=u.p0.w/u.frame.xy*2.;
 var o:V;o.position=vec4f(point+local*size,0,1);o.local=local;o.color=mix(u.c0.rgb,u.c1.rgb,p.velocity.w)*(.09+.12*p.velocity.w);return o;
}
@fragment fn fs(v:V)->@location(0) vec4f{let a=exp(-dot(v.local,v.local)*3.5);return vec4f(v.color*a,a);}
`;
