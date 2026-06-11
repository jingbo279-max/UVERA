import React, { useEffect, useState } from 'react';
import { Play, Plus, X, TreeStructure, CheckCircle } from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';

const SeriesTreeNode = ({ node, allNodes, onPlay, watchedIds }) => {
  if (!node) return null;
  const children = allNodes.filter(n => n.parentId === node.id);
  const isWatched = watchedIds.has(node.id);

  return (
    <div className="flex flex-col items-center">
      <div 
        onClick={() => onPlay(node)}
        className={`relative w-40 h-24 rounded-xl border-2 cursor-pointer transition-all hover:scale-105 group overflow-hidden ${isWatched ? 'border-background-tertiary opacity-70' : 'border-accent shadow-[0_0_15px_rgba(var(--color-accent),0.3)]'}`}
      >
        <img src={node.cover || `https://image.mux.com/${node.video}/thumbnail.jpg`} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Play size={24} weight="fill" className="text-white" />
        </div>
        
        {/* Watch Status Badge */}
        {isWatched ? (
          <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded flex items-center gap-1">
            <CheckCircle size={12} weight="fill" className="text-gray-400" />
            <span className="text-[9px] font-bold text-gray-300 uppercase">Watched</span>
          </div>
        ) : (
          <div className="absolute top-1.5 right-1.5 bg-accent/90 backdrop-blur-md px-1.5 py-0.5 rounded flex items-center gap-1 shadow-lg">
            <span className="text-[9px] font-bold text-white uppercase tracking-wider">New</span>
          </div>
        )}
        
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
          <p className="text-[10px] text-white font-medium line-clamp-1">{node.title}</p>
        </div>
      </div>
      
      {children.length > 0 && (
        <div className="flex flex-col items-center w-full mt-2">
          <div className="w-px h-6 bg-background-tertiary"></div>
          <div className="relative flex justify-center pt-4 border-t border-background-tertiary mt-[-1px]">
            {children.map((child, idx) => (
              <div key={child.id} className="relative flex flex-col items-center px-4">
                <div className="absolute top-[-16px] w-px h-4 bg-background-tertiary"></div>
                <SeriesTreeNode node={child} allNodes={allNodes} onPlay={onPlay} watchedIds={watchedIds} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function SeriesTreeOverlay({ seriesId, rootId, onClose, onPlay, onCreateBranch }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [watchedIds, setWatchedIds] = useState(new Set());

  useEffect(() => {
    // Load watched state from localStorage
    try {
      const stored = localStorage.getItem('uvera_watched_branches');
      if (stored) {
        setWatchedIds(new Set(JSON.parse(stored)));
      }
    } catch(e) {}

    async function fetchTree() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('recommended_content')
          .select('*')
          .or(`id.eq.${seriesId},tags.cs.{"#Series:${seriesId}"}`);
          
        if (error) throw error;
        
        const treeNodes = (data || []).map(w => {
          const pt = (w.tags || []).find(t => typeof t === 'string' && t.startsWith('#Parent:'));
          return { ...w, parentId: pt ? pt.split(':')[1] : null };
        });
        setNodes(treeNodes);
      } catch (err) {
        console.error('Failed to fetch series tree', err);
      } finally {
        setLoading(false);
      }
    }
    fetchTree();
  }, [seriesId]);

  const rootNode = nodes.find(n => n.id === rootId || !n.parentId);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-6xl h-[85vh] bg-background border border-background-secondary rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-fade-in">
        <div className="flex justify-between items-center p-6 border-b border-background-secondary bg-background/80 backdrop-blur z-10 relative">
          <div>
            <h2 className="text-2xl font-bold text-label flex items-center gap-2">
              <TreeStructure size={24} className="text-accent" />
              Series Branch Tree
            </h2>
            <p className="text-sm text-label-secondary mt-1">Explore all branching episodes. Create your own branch from any node!</p>
          </div>
          <div className="flex items-center gap-4">
            {onCreateBranch && (
              <button 
                onClick={onCreateBranch}
                className="px-4 py-2 bg-accent text-white rounded-full font-medium flex items-center gap-2 hover:bg-accent/90 transition-colors"
              >
                <Plus size={18} weight="bold" />
                Create New Branch
              </button>
            )}
            <button onClick={onClose} className="w-10 h-10 rounded-full hover:bg-background-secondary flex items-center justify-center text-label-secondary transition-colors">
              <X size={24} />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-12 bg-[#0A0A0A] flex justify-center items-start min-h-0 relative">
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white">Loading tree...</span>
            </div>
          ) : (
            <div className="inline-block relative z-10 pt-4 pb-20">
              {rootNode ? (
                <SeriesTreeNode node={rootNode} allNodes={nodes} onPlay={onPlay} watchedIds={watchedIds} />
              ) : (
                <p className="text-white/50">Root node not found.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
