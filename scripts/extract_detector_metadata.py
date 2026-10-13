#!/usr/bin/env python3
"""Extract exact fixed anchors/normalization from a hash-pinned model (stdlib only).
Schemas: MediaPipe tasks/metadata/{metadata_schema,object_detector_metadata_schema}.fbs
"""
import struct,json,hashlib,pathlib,zipfile
PATH=pathlib.Path(__file__).resolve().parents[1]/'public/models/efficientdet.tflite'
EXPECTED='40338edf5ec70d43e318b0a716a84d4564cd1802759a7a07170c7e43796dbf58'
class TableReader:
 def __init__(self,b):self.b=b
 def u(self,p):return struct.unpack_from('<I',self.b,p)[0]
 def i(self,p):return struct.unpack_from('<i',self.b,p)[0]
 def f(self,p):return struct.unpack_from('<f',self.b,p)[0]
 def field(self,t,i):
  vt=t-self.i(t);n=struct.unpack_from('<H',self.b,vt)[0];o=struct.unpack_from('<H',self.b,vt+4+i*2)[0] if 4+i*2<n else 0
  return t+o if o else None
 def ind(self,p):return p+self.u(p)
 def table(self,t,i):return self.ind(self.field(t,i))
 def vector(self,t,i):p=self.ind(self.field(t,i));return p+4,self.u(p)
 def tables(self,t,i):p,n=self.vector(t,i);return [self.ind(p+4*j) for j in range(n)]
 def text(self,t,i):p=self.table(t,i);return self.b[p+4:p+4+self.u(p)].decode()
 def floats(self,t,i):p,n=self.vector(t,i);return [self.f(p+j*4) for j in range(n)]
b=PATH.read_bytes();assert hashlib.sha256(b).hexdigest()==EXPECTED,'Unexpected model'
r=TableReader(b);root=r.u(0);buffers=r.tables(root,4)
for m in r.tables(root,6):
 if r.text(m,0)=='TFLITE_METADATA':
  index=r.u(r.field(m,1));p,n=r.vector(buffers[index],0);metadata=b[p:p+n];break
else:raise ValueError('metadata missing')
r=TableReader(metadata);root=r.u(0);sg=r.tables(root,3)[0];tensor=r.tables(sg,2)[0];unit=r.tables(tensor,4)[0];norm=r.table(unit,1);normalization={'mean':r.floats(norm,0),'std':r.floats(norm,1)}
start=metadata.index(b'V001')-4;assert metadata.count(b'V001')==1;r=TableReader(metadata[start:]);root=r.u(0);fixed=r.table(r.table(root,1),0);anchors=[]
for t in r.tables(fixed,0):anchors.append([r.f(r.field(t,j)) if r.field(t,j) else 0 for j in range(4)])
t=r.table(root,2);names=['num_classes','num_boxes','num_coords','keypoint_coord_offset','num_keypoints','num_values_per_keypoint','x_scale','y_scale','w_scale','h_scale','apply_exponential_on_box_size','sigmoid_score'];decode={}
for i,k in enumerate(names):
 p=r.field(t,i);decode[k]=(r.i(p) if i<6 else r.f(p) if i<10 else bool(r.b[p])) if p else (False if i>=10 else 0)
assert len(anchors)==19206 and decode['num_classes']==90
out={'source':'Embedded metadata in Google EfficientDet-Lite0 float32/1','modelSha256':EXPECTED,'normalization':normalization,'decode':decode,'anchors':anchors}
PATH.with_name('efficientdet-anchors.json').write_text(json.dumps(out,separators=(',',':'))+'\n')
with zipfile.ZipFile(PATH)as z:PATH.with_name('labels.txt').write_bytes(z.read('labels.txt'))
print(json.dumps({'anchors':len(anchors),'normalization':normalization,'decode':decode},indent=2))
