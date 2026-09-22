from pathlib import Path
from html import escape
import json, xml.etree.ElementTree as ET
D=Path(__file__).parent
N='#142B4A'; M='#58677B'; S='#F3F5F8'; B='#CDD4DE'; W='#FFFFFF'; BLUE='#426A9B'
def r(x,y,w,h,c=S,rad=12,stroke=None):
 return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rad}" fill="{c}"'+(f' stroke="{stroke}"' if stroke else '')+'/>'
def t(x,y,s,size=16,c=N,weight=400,anchor=None):
 return f'<text x="{x}" y="{y}" font-family="Segoe UI,Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{c}"'+(f' text-anchor="{anchor}"' if anchor else '')+'>'+escape(s)+'</text>'
def line(x1,y1,x2,y2,c=B,width=1):return f'<path d="M{x1} {y1}H{x2}" stroke="{c}" stroke-width="{width}"/>' if y1==y2 else f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{c}" stroke-width="{width}"/>'
def mark(x,y,size=40,c=N):
 # Frame inner bounds: x=10..54, y=12..54. Z bounds: x=20..44, y=22..44. Equal 10-unit padding on all four sides.
 return f'<g transform="translate({x} {y}) scale({size/64})"><path d="M43 10H14a6 6 0 0 0-6 6v34a6 6 0 0 0 6 6h36a6 6 0 0 0 6-6V29" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round"/><path d="M20 22h24v6L29 38h15v6H20v-6l15-10H20Z" fill="{c}"/><rect x="49" y="4" width="13" height="13" rx="2" fill="{c}"/></g>'
def brand(x,y,c=N):return mark(x,y,36,c)+t(x+48,y+27,'ZanLM',24,c,650)
def btn(x,y,s,w=160,primary=True):return r(x,y,w,44,N if primary else W,8,None if primary else B)+t(x+w/2,y+28,s,14,W if primary else N,600,'middle')
def nav(work=False):
 return r(48,24,1104,64,W,32,B)+brand(72,38)+t(770,62,'Workspace' if work else 'How it works',14,M)+btn(968,34,'New deck' if work else 'Convert a deck',164)
def page(c,title):return f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800" role="img"><title>{escape(title)}</title>'+r(0,0,1200,800,W,0)+c+'</svg>'
def slide(x,y,w=480,edited=False):
 # All source slide elements use one 640 x 360 coordinate system, preserving 16:9.
 c=r(0,0,640,360,'#EAF0F7',8)+t(36,48,'THE NEXT CHAPTER',14,M,600)
 c+=t(36,114,'Room to grow.',38,N,650)+t(36,148,'A clearer perspective.',18,M)
 c+=r(36,226,278,92,'#D3DFED',8)+t(56,261,'01 / New possibilities',18,N,600)+t(56,292,'Start with one good idea.',15,M)
 # Abstract architectural object, isolated in the right third with no text overlap.
 c+=r(426,118,152,200,'#B2C5DD',76)+r(455,151,94,167,'#7696BD',47)+r(480,186,44,132,N,22)
 if edited:
  for a,b,d,e in [(30,77,305,47),(421,113,162,210)]:
   c+=r(a,b,d,e,'none',0,BLUE)
   for px,py in [(a,b),(a+d,b),(a,b+e),(a+d,b+e)]:c+=r(px-3,py-3,6,6,W,0,BLUE)
 return f'<g transform="translate({x} {y}) scale({w/640})">{c}</g>'
def header(k,title,sub=None):return t(64,142,k,12,M,600)+t(64,194,title,36,N,600)+(t(64,228,sub,16,M) if sub else '')
pages=[]
a=nav()+t(64,158,'SLIDES, MADE EDITABLE',12,M,600)+t(64,225,'Keep the idea.',56,N,600)+t(64,287,'Edit everything around it.',56,N,600)+t(64,328,'Image-based slides to editable PowerPoint.',18,M)+btn(64,356,'Convert a deck',174)
a+=t(64,451,'Original',13,M)+t(644,451,'Editable',13,M)+slide(64,470,492)+slide(644,470,492,True)+t(600,617,'→',26,M,400,'middle')+t(64,780,'Upload  /  Separate  /  Edit',13,M)+t(1136,780,'What to expect ↗',13,M,400,'end')
pages.append(('01-home.svg','Home',a))
a=nav()+r(64,152,496,568,S,16)+mark(225,275,160)+t(312,519,'Your slides. Your workspace.',23,N,600,'middle')+t(312,686,'Izzan Faikar Ramadhy',13,M,400,'middle')
a+=t(672,271,'Welcome back.',36,N,600)+t(672,312,'Enter your access code.',16,M)+t(672,371,'Access code',14,N,600)+r(672,388,400,52,W,8,B)+t(692,422,'••••••••',20,M)+btn(672,464,'Continue',400)+t(672,551,'Private workspace',13,M)
pages.append(('02-sign-in.svg','Sign in',a))
a=nav(True)+header('NEW DECK','Start with your slides.')+r(64,246,1072,346,S,16,B)
a+=f'<path d="M600 354v-54m-16 17l16-17 16 17m-42 38v19h52v-19" stroke="{N}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
a+=t(600,415,'Drop your file here',28,N,600,'middle')+t(600,451,'PPTX, PDF, PNG, JPG · 50 MB · 40 slides',15,M,400,'middle')+btn(514,482,'Browse files',172)+t(64,635,'Images go to Gemini for detection. Other processing runs locally.',14,M)+t(64,685,'Worker · Not connected',13,M)+t(1136,685,'What to expect ↗',13,M,400,'end')
pages.append(('03-upload.svg','Upload',a))
a=nav(True)+header('PROCESSING','Separating your slides.')+t(1136,190,'2 / 6 complete',16,M,400,'end')+r(64,228,1072,6,S,3)+r(64,228,357,6,N,3)
for i,(name,status) in enumerate([('01','Complete'),('02','Complete'),('03','Cleaning background'),('04','Queued')]):
 y=274+i*88
 a+=r(64,y,1072,72,S,10)+t(88,y+43,name,15,M)+r(133,y+14,78,44,'#D3DFED',4)+t(241,y+43,'Slide '+str(i+1),16,N,600)+t(1108,y+43,status,14,M,400,'end')
a+=t(64,679,'Detect  →  Separate  →  Clean  →  Assemble',14,M)+btn(976,655,'Cancel',160,False)+t(64,751,'Preview data · Device status appears when connected',12,M)
pages.append(('04-processing.svg','Processing',a))
a=nav(True)+header('REVIEW / 03 OF 06','Review your slide.')+btn(976,160,'Export deck',160)+t(64,262,'Original',13,M)+t(452,262,'Editable',13,M)+slide(64,280,364)+slide(452,280,364,True)
a+=r(840,240,296,456,S,12)+t(864,275,'Text',18,N,600)+t(1112,273,'Check text',12,'#8A5518',400,'end')+t(864,316,'Type',13,M)+r(864,327,248,40,W,8,B)+t(880,353,'Text',14)+t(1096,353,'⌄',16,M,400,'end')+t(864,403,'Content',13,M)+r(864,415,248,64,W,8,B)+t(880,452,'Room to grow.',17)+t(864,518,'Position & size',13,M)
for x,y,l,v in [(864,534,'X','30'),(992,534,'Y','77'),(864,585,'W','305'),(992,585,'H','47')]:
 a+=r(x,y,120,40,W,6,B)+t(x+12,y+25,l,12,M)+t(x+104,y+25,v,14,N,400,'end')
a+=btn(864,641,'Apply',248)
a+=r(64,515,752,48,S,8)+t(88,545,'Layers',13,M)+t(174,545,'☑ Background     ☑ Panels     ☑ Objects     ☑ Text',14)+t(64,608,'Side by side',13,N,600)+t(182,608,'/  Compare',13,M)
for i in range(4):a+=r(64+i*94,641,78,44,'#D3DFED' if i==2 else S,6,BLUE if i==2 else None)+t(103+i*94,668,f'0{i+1}',13,N,400,'middle')
a+=btn(650,641,'Reprocess',166,False)+t(64,751,'Preview data',12,M)
pages.append(('05-review-fix.svg','Review & fix',a))
a=nav(True)+header('EXPORT','Ready for PowerPoint.')+r(64,254,1072,160,S,12)
for x,num,label in [(96,'6','Slides'),(357,'42','Text boxes'),(618,'18','Images'),(879,'12','Shapes')]:a+=t(x,320,num,40,N,600)+t(x,359,label,15,M)
a+=t(64,463,'□ Include original slides as hidden references',16)+btn(64,495,'Download .pptx',212)+t(304,523,'Back to review',14,M)+line(64,582,1136,582)+t(64,621,'Images stay image objects. Fonts and repaired areas may differ.',15,M)+t(64,660,'View limitations ↗',14,M)+t(64,751,'Preview data',12,M)
pages.append(('06-download.svg','Download',a))
for fn,title,c in pages:(D/fn).write_text(page(c,title),encoding='utf-8')
# Logo exports: frame + detached square represents a slide and an extracted object.
for inv in [False,True]:
 c=N if not inv else W;bg=W if not inv else N
 s=f'<svg xmlns="http://www.w3.org/2000/svg" width="520" height="180" viewBox="0 0 520 180">'+r(0,0,520,180,bg,0)+mark(42,42,94,c)+t(160,120,'ZanLM',66,c,600)+'</svg>'
 (D/('zanlm-logo-inverse.svg' if inv else 'zanlm-logo.svg')).write_text(s)
(D/'zanlm-mark.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'+mark(0,0,64)+'</svg>')
(D/'zanlm-icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'+r(0,0,96,96,N,20)+mark(14,14,68,W)+'</svg>')
board=r(0,0,1264,1460,S,0)+t(32,45,'ZanLM / Revision 3',25,N,600)+t(32,76,'White & navy · Concise copy · Aligned layouts · Illustrative data',14,M)
for i,(fn,title,c) in enumerate(pages):
 x=24+(i%2)*616;y=108+(i//2)*454
 board+=t(x,y+20,f'0{i+1} / {title}',15,N,600)+f'<g transform="translate({x} {y+32}) scale(.5)">'+r(0,0,1200,800,W,0)+c+'</g>'
(D/'screens.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1264" height="1460" viewBox="0 0 1264 1460">'+board+'</svg>')
a=t(64,80,'Navigation options',32,N,600)
for i,title in enumerate(['A / Studio pill — recommended','B / Compact','C / Split']):
 y=143+i*208;a+=t(64,y,title,18,N,600)
 if i==0:a+=f'<g transform="translate(0 {y+4})">'+nav()+'</g>'
 elif i==1:a+=r(260,y+35,680,64,W,32,B)+brand(284,y+49)+t(615,y+74,'Workspace',14,M)+t(850,y+74,'Menu',14,N)
 else:a+=r(64,y+35,220,64,W,32,B)+brand(84,y+49)+r(380,y+35,430,64,W,32,B)+t(427,y+74,'Home',14)+t(518,y+74,'How it works',14,M)+t(664,y+74,'Workspace',14,M)+btn(952,y+45,'Convert a deck',184)
(D/'navbar-options.svg').write_text(page(a,'Navigation options'))
# Dark preview generated from upload using role-aware color transformation.
a=pages[2][2]
for old,new in [(W,'__WHITE__'),(N,'__NAVY__'),(S,'#192A42'),(B,'#41536D'),(M,'#B4C1D3')]:a=a.replace(old,new)
a=a.replace('__WHITE__','#101C2E').replace('__NAVY__','#F7F9FC')
(D/'dark-mode.svg').write_text(page(a,'Dark mode').replace('fill="#FFFFFF"','fill="#101C2E"'))
tokens=json.loads((D/'tokens.json').read_text());tokens['color']['success']=N;tokens['darkColor']['success']='#E2EAF5';(D/'tokens.json').write_text(json.dumps(tokens,indent=2))
for p in D.glob('*.svg'):ET.parse(p)
print('Rebuilt all mockups, logo assets, nav options and dark preview.')
