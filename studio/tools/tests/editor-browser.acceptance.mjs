// Run against a fresh /editor page at 1440×960 using an existing Playwright Page.
// Does not launch, close, or restart any browser.
export async function verifyEditorInteractions(page) {
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
assert(await page.locator('.template-card').count()===27,'catalog 27');
await page.getByRole('button',{name:'添加 数字重击',exact:true}).count().then(async n=>{if(n)await page.getByRole('button',{name:'添加 数字重击',exact:true}).click();else {await page.getByLabel('搜索模板').fill('number-beat');await page.locator('.template-card').click();}});
assert(await page.locator('.clip').count()===1,'add');
await page.keyboard.press('Backspace');assert(await page.locator('.clip').count()===0,'backspace delete');
await page.keyboard.press('Meta+z');assert(await page.locator('.clip').count()===1,'undo delete');
await page.locator('.clip').click();await page.keyboard.press('Meta+d');assert(await page.locator('.clip').count()===2,'duplicate');
await page.getByLabel('搜索模板').fill('abc');await page.keyboard.press('Backspace');assert(await page.locator('.clip').count()===2,'input backspace isolation');
await page.getByLabel('搜索模板').fill('');await page.locator('.clip').last().click();await page.keyboard.press('Delete');assert(await page.locator('.clip').count()===1,'delete');
const scroll=await page.locator('.timeline-scroll').boundingBox();
await page.mouse.move(scroll.x+300,scroll.y+110);await page.mouse.down();await page.mouse.move(scroll.x+750,scroll.y+110,{steps:12});await page.mouse.up();
assert(Number(await page.getByLabel('播放进度',{exact:true}).inputValue())>100,'blank scrub');
const head=await page.getByLabel('拖动播放头').boundingBox();await page.mouse.move(head.x+8,head.y+8);await page.mouse.down();await page.mouse.move(scroll.x+400,head.y+8,{steps:12});await page.mouse.up();
const moved=Number(await page.getByLabel('播放进度',{exact:true}).inputValue());assert(moved>30&&moved<100,'head scrub');
await page.getByRole('button',{name:'吸附到边界',exact:true}).click();
const clip=await page.locator('.clip').boundingBox();await page.mouse.move(clip.x+30,clip.y+15);await page.mouse.down();await page.mouse.move(clip.x+160,clip.y+15,{steps:12});await page.mouse.up();assert(Number(await page.getByLabel('起始帧',{exact:true}).inputValue())>20,'clip move');
const handle=await page.locator('.handle.right').boundingBox();const duration=Number(await page.getByLabel('持续帧数',{exact:true}).inputValue());await page.mouse.move(handle.x+5,handle.y+15);await page.mouse.down();await page.mouse.move(handle.x+85,handle.y+15,{steps:12});await page.mouse.up();assert(Number(await page.getByLabel('持续帧数',{exact:true}).inputValue())>duration,'trim');
await page.getByLabel('搜索模板').fill('key-concept');await page.locator('.template-card').click();assert(await page.locator('.clip').count()===2,'generic add');
await page.getByLabel('搜索模板').fill('');await page.screenshot({path:'workspace/editor-redesign/interaction-checked.png'});
}
