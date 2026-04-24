"use client";
import React, { useEffect, useState } from 'react';

export default function TmpList() {
  const [files, setFiles] = useState<Array<{name:string,size:number,mtime:string}>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchList(); }, []);

  async function fetchList() {
    setLoading(true);
    try {
      const res = await fetch('/api/tmp/list');
      const js = await res.json();
      setFiles(js || []);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }

  return (
    <div style={{padding:20}}>
      <h2>Saved tmp images</h2>
      {loading ? <div>Loading…</div> : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12}}>
          {files.map(f => (
            <div key={f.name} style={{border:'1px solid #eee',padding:8}}>
              <div style={{fontSize:12,color:'#666'}}>{f.name}</div>
              <div style={{marginTop:8}}>
                <img src={`/api/tmp/get?name=${encodeURIComponent(f.name)}`} style={{width:'100%',maxHeight:160,objectFit:'contain'}} onError={(e)=>{(e.target as HTMLImageElement).style.display='none'}} />
              </div>
              <div style={{marginTop:8,display:'flex',gap:8}}>
                <a href={`/warehouse/decoder?src=${encodeURIComponent('/api/tmp/get?name=' + f.name)}`} className="btn">Open in decoder</a>
                <a href={`/api/tmp/get?name=${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer">Open raw</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
