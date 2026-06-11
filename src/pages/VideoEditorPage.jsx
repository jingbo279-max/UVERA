import React, { useState, useEffect, useRef } from 'react';
import { CaretLeft, VideoCamera, MagicWand, Plus, Trash, ArrowsLeftRight, ArrowsSplit, CheckCircle, CircleNotch } from '@phosphor-icons/react';
import { generateVolcengineVideo, pollVolcengineVideoStatus, uploadUrlToCloudflareStream } from '../api/neoaiService';
import { supabase } from '../api/supabaseClient';

export default function VideoEditorPage({ isSmallScreen, onBack, userTier }) {
  const [draft, setDraft] = useState(null);
  
  const [activeTab, setActiveTab] = useState('element'); // 'element' | 'extend' | 'track'
  
  // Element Mod state
  const [elementAction, setElementAction] = useState('modify'); // 'add' | 'delete' | 'modify'
  const [elementTime, setElementTime] = useState('第0-2秒');
  const [elementSpace, setElementSpace] = useState('左下角');
  const [elementTarget, setElementTarget] = useState('原有的杯子');
  const [elementDesc, setElementDesc] = useState('一只可爱的发光史莱姆');

  // Extend state
  const [extendDir, setExtendDir] = useState('backward'); // 'forward' | 'backward'
  const [extendDesc, setExtendDesc] = useState('主角转身走向森林深处');

  // Track Fill state
  const [trackPrompts, setTrackPrompts] = useState(['镜头推近，时空穿梭特效']);
  const [trackVideos, setTrackVideos] = useState([]); // Up to 3 videos. The first is pre-filled from draft.
  // Wait, selecting multiple videos requires a library picker. For MVP, we'll let users paste a URL or just use the first video and mock the others if needed.

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [previewVideoUrl, setPreviewVideoUrl] = useState('');
  
  useEffect(() => {
    try {
      const dStr = localStorage.getItem('uvera_video_edit_draft');
      if (dStr) {
        const d = JSON.parse(dStr);
        setDraft(d);
        setTrackVideos([d.videoUrl]);
      } else {
        onBack();
      }
    } catch(e) { onBack(); }
  }, [onBack]);

  const handleSubmit = async () => {
    if (!draft) return;
    setIsGenerating(true);
    setRenderProgress(1); // Starting
    
    try {
      let finalPrompt = '';
      if (activeTab === 'element') {
        if (elementAction === 'add') finalPrompt = `增加元素：在「视频1」的${elementTime}${elementSpace}，增加${elementDesc}。`;
        else if (elementAction === 'delete') finalPrompt = `删除元素：删除「视频1」中的${elementTarget}，视频其他内容保持不变。`;
        else finalPrompt = `修改元素：将「视频1」中的${elementTarget}，替换为${elementDesc}。`;
      } else if (activeTab === 'extend') {
        if (extendDir === 'forward') finalPrompt = `向前延长「视频1」，${extendDesc}`;
        else finalPrompt = `向后延长「视频1」，${extendDesc}`;
      } else if (activeTab === 'track') {
        // Build track prompt
        let tp = `「视频1」`;
        if (trackVideos.length > 1 && trackPrompts[0]) tp += ` + ${trackPrompts[0]} + 接「视频2」`;
        if (trackVideos.length > 2 && trackPrompts[1]) tp += ` + ${trackPrompts[1]} + 接「视频3」`;
        finalPrompt = tp;
      }
      
      // §2026-05-15: model omitted → worker reads default from system_settings
      // (admin-rotatable). Was hardcoded 'ep-20260423195810-cx7nc' which is
      // now deprecated. Worker default is currently 'ep-20260507183959-d7mr2'
      // (Seedance 2.0 Fast).
      const payload = {
        prompt: finalPrompt,
        videoUrl: draft.videoUrl, // Main video
        videoUrls: trackVideos, // Pass array if backend supports Seedance 2.0 multi-video
        duration: 5,
        ratio: '16:9',
        resolution: '720p',
      };
      
      setRenderProgress(2); // Submitting to Volcengine
      const taskId = await generateVolcengineVideo(payload);
      
      setRenderProgress(3); // Rendering
      let isDone = false;
      let outVideoUrl = '';
      const startTime = Date.now();
      while(!isDone) {
         if (Date.now() - startTime > 30 * 60 * 1000) throw new Error('Timeout');
         await new Promise(r => setTimeout(r, 6000));
         const status = await pollVolcengineVideoStatus(taskId);
         if (status.status === 'succeeded') { isDone = true; outVideoUrl = status.videoUrl; }
         else if (status.status === 'failed') throw new Error(status.errorMessage || 'Failed');
      }
      
      setPreviewVideoUrl(outVideoUrl);
      setRenderProgress(3.5); // CDN

      // §2026-05-15 P0.b: pass taskId for file_size_bytes capture in generation_logs
      const permanentVideoUrl = await uploadUrlToCloudflareStream(outVideoUrl, { taskId });
      
      // Save to recommended_content
      const { data: authData } = await supabase.auth.getSession();
      if (authData?.session) {
         await supabase.from('recommended_content').insert([{
           artist: authData.session.user.id,
           title: `[Edited] ${draft.title || 'Video'}`,
           video: permanentVideoUrl,
           cover: draft.coverUrl,
           media_kind: 'Video',
           published: false,
           tags: ['#Edited']
         }]);
      }
      
      setRenderProgress(4);
    } catch(err) {
      console.error(err);
      alert('Edit failed: ' + err.message);
      setIsGenerating(false);
      setRenderProgress(0);
    }
  };

  if (!draft) return null;

  return (
    <div className="w-full h-full overflow-y-auto bg-background text-label pb-20">
      <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-md border-b border-background-tertiary px-4 py-4 flex items-center gap-3">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-background-secondary transition">
          <CaretLeft size={22} weight="bold" />
        </button>
        <h1 className="text-lg font-bold">Seedance 2.0 Video Editor</h1>
      </div>
      
      <div className="max-w-4xl mx-auto p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Col: Original Video & Tabs */}
        <div className="space-y-6">
          <div className="aspect-video bg-black rounded-xl overflow-hidden border border-background-tertiary shadow-lg relative">
             <video src={draft.videoUrl} poster={draft.coverUrl} controls className="w-full h-full object-contain" />
             <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2 py-1 rounded text-[10px] text-white font-medium">Source Video</div>
          </div>
          
          <div className="flex bg-background-secondary rounded-lg p-1 gap-1">
             <button onClick={() => setActiveTab('element')} className={`flex-1 py-2 text-sm font-medium rounded-md transition ${activeTab === 'element' ? 'bg-background shadow text-accent' : 'text-label-secondary'}`}>元素增删改</button>
             <button onClick={() => setActiveTab('extend')} className={`flex-1 py-2 text-sm font-medium rounded-md transition ${activeTab === 'extend' ? 'bg-background shadow text-accent' : 'text-label-secondary'}`}>视频延长</button>
             <button onClick={() => setActiveTab('track')} className={`flex-1 py-2 text-sm font-medium rounded-md transition ${activeTab === 'track' ? 'bg-background shadow text-accent' : 'text-label-secondary'}`}>轨道补齐</button>
          </div>
          
          <div className="bg-white border border-background-tertiary rounded-xl p-5 shadow-sm space-y-4">
             {activeTab === 'element' && (
               <>
                 <div className="flex gap-2 mb-4">
                   {['add', 'delete', 'modify'].map(a => (
                     <button key={a} onClick={() => setElementAction(a)} className={`flex-1 py-2 text-sm rounded-lg border ${elementAction === a ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-background-tertiary text-label-secondary'}`}>
                       {a === 'add' ? '增加元素' : a === 'delete' ? '删除元素' : '修改元素'}
                     </button>
                   ))}
                 </div>
                 
                 {elementAction === 'add' && (
                   <div className="space-y-3">
                     <input value={elementTime} onChange={e=>setElementTime(e.target.value)} placeholder="时间位置 (例: 第0-2秒)" className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm" />
                     <input value={elementSpace} onChange={e=>setElementSpace(e.target.value)} placeholder="空间位置 (例: 左下角)" className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm" />
                     <textarea value={elementDesc} onChange={e=>setElementDesc(e.target.value)} placeholder="理想元素描述 (例: 一只发光史莱姆)" className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm h-24 resize-none" />
                   </div>
                 )}
                 {elementAction === 'delete' && (
                   <div className="space-y-3">
                     <input value={elementTarget} onChange={e=>setElementTarget(e.target.value)} placeholder="被删除元素" className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm" />
                   </div>
                 )}
                 {elementAction === 'modify' && (
                   <div className="space-y-3">
                     <input value={elementTarget} onChange={e=>setElementTarget(e.target.value)} placeholder="被更换元素描述" className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm" />
                     <textarea value={elementDesc} onChange={e=>setElementDesc(e.target.value)} placeholder="理想元素描述" className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm h-24 resize-none" />
                   </div>
                 )}
               </>
             )}
             
             {activeTab === 'extend' && (
               <>
                 <div className="flex gap-2 mb-4">
                   <button onClick={() => setExtendDir('forward')} className={`flex-1 py-2 text-sm rounded-lg border ${extendDir === 'forward' ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-background-tertiary text-label-secondary'}`}>向前延长 (生成前传)</button>
                   <button onClick={() => setExtendDir('backward')} className={`flex-1 py-2 text-sm rounded-lg border ${extendDir === 'backward' ? 'border-accent bg-accent/10 text-accent font-medium' : 'border-background-tertiary text-label-secondary'}`}>向后延长 (生成后续)</button>
                 </div>
                 <textarea value={extendDesc} onChange={e=>setExtendDesc(e.target.value)} placeholder="需延长的视频描述..." className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-lg text-sm h-24 resize-none" />
               </>
             )}
             
             {activeTab === 'track' && (
               <div className="space-y-4">
                 <p className="text-xs text-label-secondary">提供多个视频时，系统将智能截取衔接部分。</p>
                 <div className="p-3 border border-background-tertiary rounded-lg bg-background flex flex-col gap-2 text-sm">
                   <div className="font-medium text-accent">视频 1: {draft.title}</div>
                   <input value={trackPrompts[0]} onChange={e => { const a = [...trackPrompts]; a[0] = e.target.value; setTrackPrompts(a); }} placeholder="过渡画面描述 1" className="w-full px-3 py-2 border border-background-secondary rounded-md" />
                   <div className="font-medium text-blue-500">视频 2 (可填入视频URL)</div>
                   <input placeholder="https://..." onChange={e => { const a = [...trackVideos]; a[1] = e.target.value; setTrackVideos(a); }} className="w-full px-3 py-2 border border-background-secondary rounded-md" />
                   <input value={trackPrompts[1] || ''} onChange={e => { const a = [...trackPrompts]; a[1] = e.target.value; setTrackPrompts(a); }} placeholder="过渡画面描述 2" className="w-full px-3 py-2 border border-background-secondary rounded-md" />
                   <div className="font-medium text-purple-500">视频 3 (可填入视频URL)</div>
                   <input placeholder="https://..." onChange={e => { const a = [...trackVideos]; a[2] = e.target.value; setTrackVideos(a); }} className="w-full px-3 py-2 border border-background-secondary rounded-md" />
                 </div>
               </div>
             )}
          </div>
          
          <button 
             onClick={handleSubmit} 
             disabled={isGenerating}
             className="w-full py-3.5 bg-label text-background rounded-xl font-medium flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition"
          >
             {isGenerating ? <CircleNotch size={18} className="animate-spin" /> : <MagicWand size={18} />}
             {isGenerating ? '处理中...' : '提交编辑'}
          </button>
        </div>
        
        {/* Right Col: Output / Status */}
        <div className="space-y-6">
          {renderProgress > 0 && (
             <div className="bg-white border border-background-secondary rounded-xl p-6 shadow-sm">
               <h3 className="font-bold mb-4">Processing Pipeline</h3>
               <div className="space-y-4">
                 <div className={`flex items-start gap-3 ${renderProgress >= 1 ? 'opacity-100' : 'opacity-30'}`}>
                   {renderProgress > 1 ? <CheckCircle size={20} weight="fill" className="text-green-500" /> : <CircleNotch size={20} className="text-accent animate-spin" />}
                   <div className="text-sm font-medium">1. 解析编辑指令</div>
                 </div>
                 <div className={`flex items-start gap-3 ${renderProgress >= 2 ? 'opacity-100' : 'opacity-30'}`}>
                   {renderProgress > 2 ? <CheckCircle size={20} weight="fill" className="text-green-500" /> : renderProgress === 2 ? <CircleNotch size={20} className="text-accent animate-spin" /> : <div className="w-5 h-5 border-2 rounded-full border-background-tertiary" />}
                   <div className="text-sm font-medium">2. 提交 Seedance 2.0 任务</div>
                 </div>
                 <div className={`flex items-start gap-3 ${renderProgress >= 3 ? 'opacity-100' : 'opacity-30'}`}>
                   {renderProgress > 3 ? <CheckCircle size={20} weight="fill" className="text-green-500" /> : renderProgress === 3 ? <CircleNotch size={20} className="text-accent animate-spin" /> : <div className="w-5 h-5 border-2 rounded-full border-background-tertiary" />}
                   <div className="text-sm font-medium">3. 渲染融合终端成片</div>
                 </div>
                 <div className={`flex items-start gap-3 ${renderProgress >= 3.5 ? 'opacity-100' : 'opacity-30'}`}>
                   {renderProgress >= 4 ? <CheckCircle size={20} weight="fill" className="text-green-500" /> : renderProgress === 3.5 ? <CircleNotch size={20} className="text-accent animate-spin" /> : <div className="w-5 h-5 border-2 rounded-full border-background-tertiary" />}
                   <div className="text-sm font-medium">4. 全球 CDN 部署</div>
                 </div>
               </div>
               
               {renderProgress === 4 && previewVideoUrl && (
                 <div className="mt-6 pt-6 border-t border-background-tertiary animate-fade-in">
                   <h3 className="font-bold mb-3 text-green-600 flex items-center gap-2"><CheckCircle size={20} weight="fill" /> 编辑完成</h3>
                   <div className="aspect-video bg-black rounded-xl overflow-hidden shadow-lg border border-background-tertiary">
                     <video src={previewVideoUrl} controls autoPlay className="w-full h-full object-contain" />
                   </div>
                 </div>
               )}
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
