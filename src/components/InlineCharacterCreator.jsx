import React, { useState, useRef, useEffect } from 'react';
import { ArrowClockwise, CheckCircle, WarningCircle, Code, Camera } from '@phosphor-icons/react';
import { uploadToSecureOSS, saveCharacterToDB } from '../api/neoaiService';
import { supabase } from '../api/supabaseClient';

export default function InlineCharacterCreator({ onCancel, onSuccess }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  
  const [status, setStatus] = useState('idle'); // idle | uploading | saving | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [createdCharacter, setCreatedCharacter] = useState(null);

  // === Camera Logic ===
  const startCamera = async () => {
    try {
      if (streamRef.current) stopCamera();
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraError('');
    } catch (err) {
      console.error(err);
      setCameraError('Camera access denied or unavailable.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const capturePhoto = (e) => {
    e.stopPropagation();
    if (!videoRef.current || !canvasRef.current) return;
    
    requestAnimationFrame(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
        setSelectedFile(file);
        setPreviewUrl(URL.createObjectURL(file));
        setErrorMsg('');
        setStatus('idle');
        stopCamera();
      }, 'image/jpeg', 0.9);
    });
  };

  useEffect(() => {
    if (!previewUrl && status === 'idle') {
      startCamera();
    } else {
      stopCamera();
    }
    // Cleanup on unmount
    return () => {
      stopCamera();
    };
  }, [previewUrl, status]);
  // === End Camera Logic ===

  const handleRetake = (e) => {
    e.stopPropagation();
    setSelectedFile(null);
    setPreviewUrl(null);
    setStatus('idle');
  };

  const handleCreate = async () => {
    if (!selectedFile) return;
    
    try {
      setErrorMsg('');
      setStatus('uploading');
      
      const secureOssUrl = await uploadToSecureOSS(selectedFile);
      
      setStatus('saving');
      
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id || `temp_user_${Date.now()}`;
      
      const dbCharacter = await saveCharacterToDB({
        user_id: userId,
        photo_url: secureOssUrl
      });
      
      setCreatedCharacter(dbCharacter);
      setStatus('success');
      
      // Auto-return on success after a brief delay
      setTimeout(() => {
        if (onSuccess) onSuccess(dbCharacter);
      }, 1500);
      
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg(err.message || 'Failed to create character. Please try again.');
    }
  };

  return (
    <div className="w-full flex-col max-w-sm mx-auto">
      {status === 'success' ? (
        <div className="bg-background-secondary border border-green-500/30 rounded-3xl p-8 text-center space-y-6 animate-fade-in shadow-sm">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto text-green-500">
            <CheckCircle size={32} weight="fill" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2 text-label">角色建立成功</h2>
            <p className="text-label-secondary text-sm">特征提取完成，正自动带入向导...</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col w-full text-center animate-fade-in">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-base font-semibold text-label">请看镜头</h3>
            <button onClick={onCancel} className="text-sm font-medium text-label-secondary hover:text-label transition-colors">取消录入</button>
          </div>

          {/* Viewport */}
          <div className="aspect-[3/4] rounded-[2rem] flex flex-col items-center justify-center transition-all overflow-hidden relative bg-black shadow-inner">
            {/* 1. Preview State */}
            {previewUrl && (
              <>
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover opacity-90" />
                <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
                  <button 
                    onClick={handleRetake}
                    className="flex items-center justify-center bg-black/60 backdrop-blur-md hover:bg-black/80 text-white w-12 h-12 rounded-full transition-colors border border-white/20 shadow-lg"
                  >
                    <ArrowClockwise size={20} />
                  </button>
                </div>
              </>
            )}

            {/* 2. Camera Live State */}
            {!previewUrl && (
              <>
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className={`w-full h-full object-cover ${cameraError ? 'hidden' : 'block scale-x-[-1]'}`} // Flip horizontally
                />
                
                {cameraError ? (
                  <div className="text-center p-6 text-label-tertiary">
                    <WarningCircle size={40} className="mx-auto mb-2 opacity-50 text-red-400" />
                    <p className="text-sm text-red-400 max-w-[200px]">{cameraError}</p>
                  </div>
                ) : (
                  <div className="absolute bottom-6 inset-x-0 flex justify-center">
                    {/* Shutter Button */}
                    <button 
                      onClick={capturePhoto} 
                      className="w-16 h-16 rounded-full border-[3px] border-white/80 bg-white/20 backdrop-blur-md hover:bg-white/40 transition-colors shadow-2xl"
                      aria-label="Take Photo"
                    />
                  </div>
                )}
              </>
            )}
            
            {/* Canvas for snapshotting */}
            <canvas ref={canvasRef} className="hidden" />
          </div>
          
          {/* Action Row */}
          <div className="mt-8">
            <button
               onClick={handleCreate}
               disabled={!selectedFile || status === 'uploading' || status === 'saving'}
               className="w-full py-3.5 bg-label text-background font-semibold rounded-xl disabled:opacity-50 flex justify-center items-center gap-2 hover:opacity-90 transition-all shadow-md hover:shadow-lg disabled:hover:shadow-none"
             >
               {status === 'uploading' || status === 'saving' ? (
                 <span className="flex items-center gap-2"><ArrowClockwise className="animate-spin" size={18} /> 注册角色特征中...</span>
               ) : (
                 '确认使用此张照'
               )}
            </button>
          </div>

          {/* Errors */}
          {errorMsg && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-center gap-2 text-sm text-red-500">
              <WarningCircle size={16} /> {errorMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
