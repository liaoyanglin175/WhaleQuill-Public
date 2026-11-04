import {test,expect} from '@playwright/test';
for(const deviceScaleFactor of [1,1.25,1.5,2])test(`动画透明与静止触碰使用同一清晰度，缩放 ${deviceScaleFactor}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:1000,height:800},deviceScaleFactor});
 try{
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
  const pet=page.locator('.companion-character'),sprite=pet.locator('.character-video');await expect(sprite).toHaveAttribute('data-loaded','true');
  const inspect=()=>sprite.locator('video').evaluateAll(elements=>{const video=elements.find(item=>getComputedStyle(item).opacity==='1')! as HTMLVideoElement;const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;const ctx=canvas.getContext('2d')!;ctx.drawImage(video,0,0);return {width:video.videoWidth,height:video.videoHeight,corner:ctx.getImageData(0,0,1,1).data[3],body:ctx.getImageData(320,180,1,1).data[3],filter:getComputedStyle(video).filter};});
  const petBox=(await pet.boundingBox())!,facing=await sprite.evaluate(element=>getComputedStyle(element).transform);await page.mouse.move(petBox.x+3,petBox.y+28);expect(await sprite.evaluate(element=>getComputedStyle(element).transform)).toBe(facing);await page.mouse.move(petBox.x+53,petBox.y+28);expect(await sprite.evaluate(element=>getComputedStyle(element).transform)).toBe(facing);const initial=await inspect();expect(initial).toMatchObject({width:640,height:360,body:255,filter:'none'});expect(initial.corner).toBeLessThanOrEqual(2);expect((await pet.boundingBox())!.width).toBe(56);
  await pet.click({position:{x:28,y:9}});await expect(sprite).toHaveAttribute('data-action',/^(pat|wave|shy|laugh|bow|yawn)$/);await expect.poll(async()=>(await inspect()).width).toBe(640);expect((await inspect()).filter).toBe('none');expect((await pet.boundingBox())!.width).toBe(56);expect(errors).toEqual([]);
 }finally{await context.close();}
});
