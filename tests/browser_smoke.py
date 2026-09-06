"""Real-browser integration tests. Requires Playwright for Python and a WebGPU adapter.

Run a local server, then:
  python tests/browser_smoke.py --url http://localhost:8080 --chromium /path/to/chromium

For a Linux CI machine with Chromium's bundled SwiftShader and a running Xvfb:
  DISPLAY=:99 python tests/browser_smoke.py --software --chromium /usr/bin/chromium

No browser automation dependency is required by Fluxweave itself.
"""
import argparse
import base64
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8080')
parser.add_argument('--chromium', default=None)
parser.add_argument('--software', action='store_true')
parser.add_argument('--screenshot', default=None)
parser.add_argument('--results', default=None)
args = parser.parse_args()
results = []
errors = []

def passed(name, details=None):
    print('PASS', name, details or '', flush=True)
    results.append({'test': name, 'passed': True, 'details': details})

with sync_playwright() as pw:
    flags = ['--no-sandbox'] if args.software else []
    env = dict(os.environ)
    if args.software:
        flags += ['--disable-gpu-watchdog', '--enable-unsafe-webgpu',
                  '--enable-unsafe-swiftshader', '--use-angle=vulkan',
                  '--use-vulkan=swiftshader', '--enable-features=Vulkan',
                  '--disable-vulkan-surface', '--ignore-gpu-blocklist']
        env['VK_ICD_FILENAMES'] = '/usr/lib/chromium/vk_swiftshader_icd.json'
    browser = pw.chromium.launch(executable_path=args.chromium,
        headless=not args.software, args=flags, env=env)
    page = browser.new_page(viewport={'width': 1440, 'height': 980}, device_scale_factor=1)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url, wait_until='networkidle')
    page.wait_for_function('window.fluxweave?.engine.ready', timeout=45000)
    passed('WebGPU render, compute and mesh pipelines compile')

    # Helpers execute the actual application graph and wait for its GPU queue.
    page.evaluate('''async()=>{
      window.testHelpers={
        async settle(){const f=fluxweave; f.engine.lastTime=NaN;
          await f.engine.device.queue.onSubmittedWorkDone();
          for(let retry=0;!f.engine.frame(f.time,1/30,f.playing);retry++){if(retry>100)throw new Error('GPU queue did not drain');await new Promise(r=>setTimeout(r,10));}
          await f.engine.device.queue.onSubmittedWorkDone();},
        async load(p){const f=fluxweave;f.playing=false;
          await f.engine.device.queue.onSubmittedWorkDone();f.engine.clear();
          Object.assign(p.settings,{width:320,height:180,fps:30});
          f.graph.setProject(p); f.time=0;f.engine.viewerId=f.engine.compiled.output;
          f.editor.fit();await this.settle();},
        async picture(id){const f=fluxweave,b=await f.engine.snapshot(id||f.engine.compiled.output);
          const image=await createImageBitmap(b),c=new OffscreenCanvas(image.width,image.height),
          ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
          const data=ctx.getImageData(0,0,c.width,c.height).data;let sum=0,sq=0,hash=2166136261;
          for(let i=0;i<data.length;i+=4){const v=(data[i]+data[i+1]+data[i+2])/3;
            sum+=v;sq+=v*v;hash=Math.imul(hash^data[i],16777619);}
          return {width:c.width,height:c.height,bytes:b.size,mean:sum/(data.length/4),
          variance:sq/(data.length/4)-(sum/(data.length/4))**2,hash:hash>>>0,
          center:Array.from(data.slice(((c.height>>1)*c.width+(c.width>>1))*4,((c.height>>1)*c.width+(c.width>>1))*4+4))};}
      };
    }''')

    for name in ['chroma', 'particles', 'geometry', 'audio', 'shader']:
        page.evaluate('(name)=>testHelpers.load(fluxweave.presets[name]())', name)
        if name == 'shader':
            page.wait_for_function("fluxweave.engine.states.get('shader1')?.lastGoodPipeline", timeout=15000)
            page.evaluate('()=>testHelpers.settle()')
        state = page.evaluate('''async()=>({picture:await testHelpers.picture(),
          stats:fluxweave.engine.stats, errors:[...fluxweave.engine.states.values()].filter(s=>s.error).map(s=>s.error)})''')
        assert state['picture']['variance'] > 10, state
        assert not state['errors'], state
        passed(f'{name} starter renders nonuniform pixels', state['picture'])
        if name == 'particles':
            info=page.evaluate("""async()=>{const f=fluxweave;await f.engine.device.queue.onSubmittedWorkDone();f.time=.1;
              f.engine.states.get('particles1').signature=null;f.engine.frame(f.time,1/30,false);
              return {bytes:f.engine.states.get('particles1').particleBytes,compute:f.engine.stats.compute};}""")
            assert info['bytes'] == 32768*32, info
            assert info['compute'] == 1, info
            old=state['picture']['hash']
            page.evaluate('async()=>{fluxweave.time=1;await testHelpers.settle();}')
            image=page.evaluate('()=>testHelpers.picture()')
            assert image['hash'] != old
            passed('32,768 GPU particles dispatch and move', info)
        if name == 'geometry':
            meshes=page.evaluate('()=>fluxweave.engine.meshBuffers.size')
            assert meshes > 0
            passed('indexed geometry and depth-tested rendering', {'meshBuffers':meshes})

    # Shader failures must be diagnostic, not fatal; retain the last valid program.
    old=page.evaluate('()=>testHelpers.picture("shader1")')
    diagnostic=page.evaluate('''async()=>{const e=fluxweave.engine;
      const result=await e.compileShader('fn effect(uv:vec2f)->vec4f { return unknown_symbol; }');
      return {valid:!!result.pipeline,messages:result.messages};}''')
    assert not diagnostic['valid'] and diagnostic['messages'], diagnostic
    passed('WGSL diagnostics include compiler errors', diagnostic['messages'])
    page.evaluate('''()=>{fluxweave.graph.select(['shader1']);fluxweave.actions.editor('shader');}''')
    page.locator('#shader-source').fill('fn effect(uv:vec2f)->vec4f { return vec4f(uv,0.25,1.); }')
    page.locator('#shader-compile').click()
    page.wait_for_function("fluxweave.graph.node('shader1').params.code.includes('vec4f(uv,0.25')")
    page.wait_for_timeout(300)
    page.evaluate('()=>testHelpers.settle()')
    good=page.evaluate('()=>testHelpers.picture("shader1")')
    assert good['hash'] != old['hash'], (old,good)
    page.locator('#shader-source').fill('fn effect(uv:vec2f)->vec4f { return oops; }')
    page.locator('#shader-compile').click()
    page.wait_for_function("document.querySelector('#shader-diagnostics').textContent.toLowerCase().includes('error')")
    after=page.evaluate('()=>testHelpers.picture("shader1")')
    assert after['hash'] == good['hash'], (after,good)
    passed('live shader editing applies valid code and preserves output on errors')

    # Construct a static network so cache hits and downstream invalidation are observable.
    page.evaluate('''async()=>{const {emptyProject,createNode}=await import('./src/core/graph.js');
      const p=emptyProject();for(const [id,type,x] of [['a','checker',20],['b','blur',290],['c','level',550],['unused','constant',900]]){
        const n=createNode(type,x,20);n.id=id;p.nodes.push(n);}
      p.edges=[{id:'ab',from:'a',to:'b',input:0},{id:'bc',from:'b',to:'c',input:0}];p.output='c';
      await testHelpers.load(p);fluxweave.actions.editor('network');}''')
    before=page.evaluate('()=>Object.fromEntries([...fluxweave.engine.states].map(([k,v])=>[k,v.cooks]))')
    page.evaluate('()=>testHelpers.settle()')
    after=page.evaluate('()=>Object.fromEntries([...fluxweave.engine.states].map(([k,v])=>[k,v.cooks]))')
    assert all(before[k] == after[k] for k in ['a','b','c']), (before,after)
    page.evaluate("async()=>{fluxweave.graph.update('unused','color','#aa4411');await testHelpers.settle();}")
    next_=page.evaluate('()=>Object.fromEntries([...fluxweave.engine.states].map(([k,v])=>[k,v.cooks]))')
    assert next_['a']==before['a'] and next_['c']==before['c'], next_
    page.evaluate("async()=>{fluxweave.graph.update('a','count',6);await testHelpers.settle();}")
    invalidated=page.evaluate('()=>Object.fromEntries([...fluxweave.engine.states].map(([k,v])=>[k,v.cooks]))')
    assert all(invalidated[k] > before[k] for k in ['a','b','c']), invalidated
    passed('selective recomputation and dependency invalidation', invalidated)

    # Real pointer wiring, selection, inspector edits, palette add, undo and redo.
    page.evaluate("()=>{fluxweave.graph.disconnect('ab');fluxweave.editor.fit();}")
    out=page.locator('.node[data-id="a"] .node-port.output').bounding_box()
    inp=page.locator('.node[data-id="b"] .node-port.input').bounding_box()
    page.mouse.move(out['x']+out['width']/2,out['y']+out['height']/2)
    page.mouse.down()
    page.mouse.move(inp['x']+inp['width']/2,inp['y']+inp['height']/2,steps=10)
    page.mouse.up()
    assert page.evaluate("()=>fluxweave.graph.project.edges.some(e=>e.from==='a'&&e.to==='b')")
    passed('pointer-drag creates typed graph connections')
    page.locator('.node[data-id="a"] .node-head').click()
    assert page.locator('#selected-name').input_value()=='checker1'
    page.locator('#inspector-body input[type=number]').first.fill('12')
    page.locator('#inspector-body input[type=number]').first.press('Enter')
    page.locator('#graph').focus()
    assert page.evaluate("()=>fluxweave.graph.node('a').params.count")==12
    page.keyboard.press('Control+z')
    assert page.evaluate("()=>fluxweave.graph.node('a').params.count")==6
    page.keyboard.press('Control+Shift+z')
    assert page.evaluate("()=>fluxweave.graph.node('a').params.count")==12
    passed('inspector editing, undo and redo')
    page.keyboard.press('Tab')
    page.locator('#palette-search').fill('edge')
    page.wait_for_timeout(150)
    page.locator('#palette-search').press('Enter')
    assert page.evaluate("()=>fluxweave.graph.project.nodes.some(n=>n.type==='edge')")
    passed('keyboard operator palette creates nodes')

    # Animation UI: existing tracks auto-key parameter edits at the current playhead.
    page.evaluate("()=>{fluxweave.playing=false;fluxweave.time=0;fluxweave.graph.select(['c']);}")
    page.locator('#inspector-body .key-button').first.click()
    page.evaluate('()=>{fluxweave.time=2;}')
    page.locator('#inspector-body input[type=number]').first.fill('2')
    page.locator('#inspector-body input[type=number]').first.press('Enter')
    page.locator('#graph').focus()
    animation=page.evaluate('''async()=>{fluxweave.time=1;
      const {parameterValues}=await import('./src/core/operators.js');const n=fluxweave.graph.node('c');
      return {keys:n.keyframes.brightness,value:parameterValues(n,1).brightness};}''')
    assert len(animation['keys'])==2 and 1<animation['value']<2, animation
    passed('parameter auto-keying and interpolation', animation)

    # Components must preserve boundary wiring and independently namespace runtime state.
    component=page.evaluate('''async()=>{const f=fluxweave;f.graph.select(['b','c']);
      const instance=f.graph.groupSelection('Postprocess');const second=f.graph.add('component',800,270,instance.componentId);
      f.graph.connect('a',second.id,0);f.graph.enter(instance.componentId);f.graph.update('b','radius',9);
      f.graph.enter(null);await testHelpers.settle();return {id:instance.componentId,
      internal:f.engine.compiled.nodes.filter(n=>n.originalId==='b').map(n=>({id:n.id,radius:n.params.radius})),
      inputs:f.graph.project.components[instance.componentId].inputs.length};}''')
    assert component['inputs']==1 and len(component['internal'])==2
    assert all(n['radius']==9 for n in component['internal'])
    assert component['internal'][0]['id'] != component['internal'][1]['id']
    passed('reusable subgraphs share edits with isolated runtime IDs',component)

    # Remaining texture operators, including sparse texture input slots.
    for typ in ['constant','shape','checker','transform','blur','edge','composite']:
        image=page.evaluate('''async(type)=>{const {emptyProject,createNode}=await import('./src/core/graph.js');
          const p=emptyProject(),a=createNode('checker',20,20),b=createNode(type,300,20);a.id='a';b.id='b';
          p.nodes=[a,b];p.output='b';const {OPS}=await import('./src/core/operators.js');
          if(OPS[type].inputs[0]?.type==='texture')p.edges=[{id:'ab',from:'a',to:'b',input:0}];
          await testHelpers.load(p);return {type,picture:await testHelpers.picture(),error:fluxweave.engine.states.get('b')?.error};}''',typ)
        assert not image['error'],image
        assert image['picture']['bytes']>100,image
        passed('texture operator '+typ,image['picture'])
    sparse=page.evaluate('''async()=>{const f=fluxweave;f.graph.update('a','colorA','#ff0000');f.graph.update('a','colorB','#ff0000');
      f.graph.update('b','mode','add');f.graph.update('b','opacity',1);f.graph.connect('a','b',1);f.graph.disconnect(f.graph.project.edges.find(e=>e.to==='b'&&e.input===0).id);
      await testHelpers.settle();return (await testHelpers.picture()).center;}''')
    assert sparse[0]>245 and sparse[1]<5,sparse
    passed('unconnected texture slots retain their port positions',sparse)

    # Reusing a document node ID across different output types must recreate its canvas.
    reused=page.evaluate("""async()=>{const {emptyProject,createNode}=await import('./src/core/graph.js');
      const p=emptyProject(),channel=createNode('value',20,20);channel.id='sameId';p.nodes=[channel];
      await testHelpers.load(p);const old=fluxweave.editor.elements.get('sameId');
      const q=emptyProject(),color=createNode('constant',20,20);color.id='sameId';q.nodes=[color];q.output=color.id;
      await testHelpers.load(q);return {replaced:old!==fluxweave.editor.elements.get('sameId'),
      views:fluxweave.engine.views.size,picture:await testHelpers.picture()};}""")
    assert reused['replaced'] and reused['picture']['center']==[156,119,238,255],reused
    passed('project reload recreates previews when an existing ID changes port type',reused)

    image=page.evaluate('''async()=>{const {emptyProject,createNode}=await import('./src/core/graph.js');
      const p=emptyProject(),n=createNode('image',30,30);n.id='image1';p.nodes=[n];p.output=n.id;
      const c=document.createElement('canvas');c.width=320;c.height=180;
      const ctx=c.getContext('2d');ctx.fillStyle='#24b89a';ctx.fillRect(0,0,320,180);
      const asset={id:'fixture',name:'fixture.png',mime:'image/png',data:c.toDataURL()};
      p.assets.fixture={name:asset.name,mime:asset.mime,data:asset.data};n.params.assetId=asset.id;
      await testHelpers.load(p);await fluxweave.media.asset(n.id,asset,'image');await testHelpers.settle();
      return (await testHelpers.picture()).center;}''')
    assert all(abs(a-b)<=2 for a,b in zip(image,[36,184,154,255])),image
    passed('embedded image decode → GPU upload → PNG pixel readback',image)

    # Verify frame-boundary semantics using exact GPU readback, not just graph sorting.
    delayed=page.evaluate("""async()=>{const {emptyProject,createNode}=await import('./src/core/graph.js');
      const p=emptyProject(),a=createNode('constant',20,20),f=createNode('feedback',300,20);
      a.id='source';a.params.color='#ff0000';f.id='delay';Object.assign(f.params,{decay:1,zoom:1,rotation:0});
      p.nodes=[a,f];p.edges=[{id:'capture',from:'source',to:'delay',input:0}];p.output='delay';
      await testHelpers.load(p);const zero=(await testHelpers.picture()).center;
      fluxweave.time=.1;await testHelpers.settle();const one=(await testHelpers.picture()).center;
      fluxweave.graph.update('source','color','#0000ff');fluxweave.time=.2;
      await testHelpers.settle();const two=(await testHelpers.picture()).center;
      fluxweave.time=.3;await testHelpers.settle();const three=(await testHelpers.picture()).center;
      return {zero,one,two,three};}""")
    assert delayed['zero'][0]<5 and delayed['one'][0]>250 and delayed['two'][0]>250,delayed
    assert delayed['three'][2]>250 and delayed['three'][0]<5,delayed
    passed('feedback captures after evaluation and exposes exactly the previous frame',delayed)

    # A generated, redistributable WebM fixture exercises the browser video decoder.
    video=page.evaluate("""async()=>{const {emptyProject,createNode}=await import('./src/core/graph.js');
      const p=emptyProject(),n=createNode('video',20,20);n.id='video1';p.nodes=[n];p.output=n.id;
      const blob=await (await fetch('./tests/fixtures/motion.webm')).blob();
      const data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob);});
      await testHelpers.load(p);await fluxweave.media.asset(n.id,{id:'videoFixture',data},'video');
      const v=fluxweave.media.sources.get(n.id).video;v.pause();
      await testHelpers.settle();const first=await testHelpers.picture();
      const firstState={error:fluxweave.engine.states.get(n.id)?.error,readyState:v.readyState,width:v.videoWidth,logs:fluxweave.engine.logs};
      await new Promise(resolve=>{v.addEventListener('seeked',resolve,{once:true});v.currentTime=.8;});
      await testHelpers.settle();const second=await testHelpers.picture();
      return {width:v.videoWidth,height:v.videoHeight,first,second,firstState};}""")
    assert video['width']==64 and video['height']==64 and video['first']['variance']>100 and video['first']['hash']!=video['second']['hash'] and video['second']['variance']>100,video
    passed('video decoding, frame seeking and GPU upload',video)

    page.evaluate('(name)=>testHelpers.load(fluxweave.presets[name]())','audio')
    page.evaluate("()=>{fluxweave.graph.select(['audio1']);fluxweave.playing=true;}")
    page.get_by_role('button',name='Test tone',exact=True).click()
    page.wait_for_timeout(800)
    audio=page.evaluate("()=>({active:!!fluxweave.media.sources.get('audio1')?.analyser,value:fluxweave.engine.states.get('audio1')?.data?.value})")
    assert audio['active'] and audio['value']>0,audio
    passed('WebAudio analyser produces a live audio-reactive signal',audio)
    page.evaluate("()=>{fluxweave.graph.select(['audio1']);fluxweave.graph.deleteSelected();}")
    assert page.evaluate("()=>!fluxweave.media.sources.has('audio1')")
    passed('deleting media operators releases active sources')

    # Exercise the actual Record button. Capture its Blob URL instead of triggering
    # an OS download, then require successful video decoding, not merely a WebM header.
    page.evaluate("""()=>{window.testOriginalAnchorClick=HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('.webm')||this.download.endsWith('.mp4'))window.testRecordingURL=this.href;else window.testOriginalAnchorClick.call(this);};
      fluxweave.playing=true;}""")
    page.locator('#record-button').click()
    page.wait_for_function("document.querySelector('#record-button').classList.contains('recording')")
    page.wait_for_timeout(1400)
    page.locator('#record-button').click()
    page.wait_for_function('window.testRecordingURL',timeout=15000)
    clip=page.evaluate("""async()=>{HTMLAnchorElement.prototype.click=window.testOriginalAnchorClick;
      const blob=await (await fetch(window.testRecordingURL)).blob(),v=document.createElement('video');
      v.muted=true;v.src=URL.createObjectURL(blob);await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(new Error('Recorded video could not be decoded'));});
      const result={bytes:blob.size,width:v.videoWidth,height:v.videoHeight,type:blob.type};
      URL.revokeObjectURL(v.src);v.removeAttribute('src');v.load();return result;}""")
    assert clip['bytes']>256 and clip['width']==320 and clip['height']==180,clip
    passed('Record button exports a decodable video containing actual GPU frames',clip)

    page.evaluate('''async()=>{await testHelpers.load(fluxweave.presets.chroma());
      fluxweave.graph.transact('Rename test project',()=>fluxweave.graph.project.name='Browser persistence test');
      fluxweave.graph.update('noise1','scale',4.25);}''')
    page.locator('[data-action="save"]').first.click()
    page.wait_for_timeout(1500)
    unexpected_gpu=page.evaluate("()=>fluxweave.engine.logs.filter(l=>l.level==='error')")
    assert not unexpected_gpu,unexpected_gpu
    page.reload(wait_until='networkidle')
    page.wait_for_function('window.fluxweave?.engine.ready',timeout=45000)
    restored=page.evaluate("()=>({name:fluxweave.graph.project.name,scale:fluxweave.graph.node('noise1').params.scale})")
    assert restored=={'name':'Browser persistence test','scale':4.25},restored
    passed('IndexedDB project save and reload',restored)
    assert not errors,errors
    gpu_errors=page.evaluate("()=>fluxweave.engine.logs.filter(l=>l.level==='error')")
    assert not gpu_errors,gpu_errors
    passed('no uncaught JavaScript errors or unexpected GPU validation errors')
    if args.screenshot:
        page.screenshot(path=args.screenshot,full_page=True)
    if args.results:
        Path(args.results).write_text(json.dumps({'browser':browser.version,'software':args.software,
            'checks':len(results),'results':results,'pageErrors':errors},indent=2)+'\n')
    browser.close()
print(f'{len(results)} browser integration checks passed.',flush=True)
