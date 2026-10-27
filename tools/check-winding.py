from pathlib import Path
from collections import Counter
import json
root=Path(__file__).resolve().parents[1]
r=json.loads((root/'public/assets/dust2/render.json').read_text())
stats=Counter()
for p in r['polygons']:
    v=p['vertices'];cross=[0.,0.,0.]
    for a,b in zip(v,v[1:]+v[:1]):
        cross[0]+=(a[1]-b[1])*(a[2]+b[2]);cross[1]+=(a[2]-b[2])*(a[0]+b[0]);cross[2]+=(a[0]-b[0])*(a[1]+b[1])
    dot=sum(cross[j]*p['normal'][j]for j in range(3))
    stats['reversed'if dot<-.000001 else'zero'if abs(dot)<.000001 else'correct']+=1
print(json.dumps(stats,indent=2))
