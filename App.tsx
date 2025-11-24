
import React, { useState, useRef, useEffect } from 'react';
import Whiteboard from './components/Whiteboard.tsx';
import Toolbar from './components/Toolbar.tsx';
import type { Tool, CanvasElement, ImageElement, SyncMessage } from './types.ts';
import * as pdfjsLib from 'pdfjs-dist';
import { CameraIcon, CameraOffIcon, MicIcon, MicOffIcon, ExitIcon } from './components/icons/index.tsx';
import { Peer } from 'peerjs';

// Configura o worker do PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';
type UserRole = 'host' | 'guest' | null;

const App: React.FC = () => {
  // --- App State ---
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>('#000000');
  const [lineWidth, setLineWidth] = useState<number>(4);
  
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [undoStack, setUndoStack] = useState<CanvasElement[]>([]);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);

  // --- Network/Lobby State ---
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [remotePeerIdInput, setRemotePeerIdInput] = useState<string>('');
  const [role, setRole] = useState<UserRole>(null);
  const peerRef = useRef<any | null>(null);
  const connRef = useRef<any | null>(null);
  const callRef = useRef<any | null>(null);

  // --- Video Call State ---
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const canUndo = elements.length > 0;
  const canRedo = undoStack.length > 0;

  // --- Initialization & Media ---

  useEffect(() => {
    const initCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            handleStreamSuccess(stream);
        } catch (err: any) {
            console.warn("Falha ao obter Audio+Video padrão:", err);
            try {
                const streamVideoOnly = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                handleStreamSuccess(streamVideoOnly);
                setIsMicOn(false);
                alert("Aviso: Microfone indisponível. Apenas vídeo ativado.");
            } catch (errVideo: any) {
                 console.error("Falha crítica na câmera:", errVideo);
                 alert("Não foi possível acessar a câmera. Verifique permissões ou se outro app está usando.");
            }
        }
    };

    const handleStreamSuccess = (stream: MediaStream) => {
        setMediaStream(stream);
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = stream;
        }
    };

    initCamera();

    return () => {
        if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
        if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    if (mediaStream) {
        mediaStream.getAudioTracks().forEach(track => track.enabled = isMicOn);
        mediaStream.getVideoTracks().forEach(track => track.enabled = isCamOn);
    }
  }, [isMicOn, isCamOn, mediaStream]);

  // Connect local video ref whenever stream is ready (re-render safety)
  useEffect(() => {
      if (localVideoRef.current && mediaStream) {
          localVideoRef.current.srcObject = mediaStream;
      }
  }, [mediaStream, connectionState]); // Re-attach when moving from lobby to app

  useEffect(() => {
      if (remoteVideoRef.current && remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream;
      }
  }, [remoteStream, connectionState]);


  // --- Networking Logic (PeerJS) ---

  const initializePeer = (type: 'host' | 'guest') => {
      setConnectionState('connecting');
      setRole(type);

      // Linha 109: Create Peer instance (connects to DEDICATED PeerJS server) with STUN config
const peer = new (Peer as any)(undefined, {
    host: 'peerjs-server-gilson.onrender.com', //
    port: 443, // Usar porta 443 para HTTPS
    path: '/myapp', // Caminho definido no server.js
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
       ]
    }
});
      });
      peerRef.current = peer;

      peer.on('open', (id: string) => {
          setMyPeerId(id);
          if (type === 'host') {
              // Host waits for connection
              setConnectionState('connecting'); // Stay in connecting until guest joins
          }
      });

      peer.on('connection', (conn: any) => {
          // Received connection (Host side)
          connRef.current = conn;
          setupDataConnection(conn);
          setConnectionState('connected');
          
          // Send current board state to new guest
          setTimeout(() => sendSyncMessage({ type: 'SYNC_FULL_STATE', payload: elements }), 500);
      });

      peer.on('call', (call: any) => {
          // Answer incoming call
          if (mediaStream) {
              call.answer(mediaStream);
              callRef.current = call;
              call.on('stream', (remoteStream: any) => {
                  setRemoteStream(remoteStream);
              });
          }
      });

      peer.on('error', (err: any) => {
          console.error("Peer error:", err);
          alert(`Erro de conexão: ${err.type}`);
          setConnectionState('disconnected');
      });
  };

  const connectToHost = () => {
      if (!remotePeerIdInput || !peerRef.current) return;
      
      const conn = peerRef.current.connect(remotePeerIdInput);
      connRef.current = conn;
      
      conn.on('open', () => {
          setConnectionState('connected');
          setupDataConnection(conn);
          
          // Initiate Video Call
          if (mediaStream) {
              const call = peerRef.current!.call(remotePeerIdInput, mediaStream);
              callRef.current = call;
              call.on('stream', (remoteStream: any) => {
                  setRemoteStream(remoteStream);
              });
          }
      });
  };

  const setupDataConnection = (conn: any) => {
      conn.on('data', (data: any) => {
          handleRemoteData(data as SyncMessage);
      });
      conn.on('close', () => {
          alert("A outra pessoa desconectou.");
          setConnectionState('disconnected');
          setRemoteStream(null);
      });
  };

  const sendSyncMessage = (msg: SyncMessage) => {
      if (connRef.current && connRef.current.open) {
          // Se for imagem, precisamos lidar com serialização (base64 ou url)
          // Simplificação: O App só sincroniza Paths e Image Elements básicos
          // Elementos de imagem complexos (blob) precisam ser convertidos antes de enviar
          // Este código assume que 'elements' já estão serializáveis ou a conversão é feita no payload
          connRef.current.send(msg);
      }
  };

  const handleRemoteData = (msg: SyncMessage) => {
      switch (msg.type) {
          case 'SYNC_FULL_STATE':
              // Received full state (usually guest receiving from host)
              // We need to rehydrate images if they are sent as URLs/Base64
              const rehydratedElements = (msg.payload as any[]).map(el => {
                  if (el.type === 'image' && el.src) {
                      const img = new Image();
                      img.src = el.src;
                      return { ...el, image: img };
                  }
                  return el;
              });
              setElements(rehydratedElements);
              break;
          case 'ADD_ELEMENT':
               setElements(prev => {
                   const newEl = msg.payload;
                   // Avoid duplicate
                   if (prev.find(e => e.id === newEl.id)) return prev;
                   
                   if (newEl.type === 'image' && newEl.src) {
                       const img = new Image();
                       img.src = newEl.src;
                       return [...prev, { ...newEl, image: img }];
                   }
                   return [...prev, newEl];
               });
              break;
          case 'REMOVE_ELEMENT': // Not implemented in toolbar yet but good for logic
              setElements(prev => prev.filter(el => el.id !== msg.payload));
              break;
          case 'CLEAR_BOARD':
              setElements([]);
              break;
          case 'UPDATE_ELEMENT':
               // For moving/resizing
               setElements(prev => prev.map(el => el.id === msg.payload.id ? { ...el, ...msg.payload } : el));
               break;
      }
  };

  // --- Whiteboard Actions Wrappers (to sync) ---

  const handleSetElements = (newElementsOrUpdater: React.SetStateAction<CanvasElement[]>) => {
      setElements(prev => {
          const next = typeof newElementsOrUpdater === 'function' 
            ? newElementsOrUpdater(prev) 
            : newElementsOrUpdater;
          
          // Naive Diffing to send updates
          // Se added
          if (next.length > prev.length) {
              const newEl = next[next.length - 1];
              // Prepare for network (serialize image)
              let payload = { ...newEl };
              if (newEl.type === 'image') {
                   // Para simplificar, assumimos que imagens vêm de src ou convertemos canvas toURL se necessário
                   // Em produção real, enviariamos o Blob via DataChannel separado ou URL
                   if (newEl.image && newEl.image.src.startsWith('data:')) {
                       (payload as any).src = newEl.image.src;
                       // Remove non-serializable DOM element
                       (payload as any).image = undefined; 
                   }
              }
              sendSyncMessage({ type: 'ADD_ELEMENT', payload });
          } 
          // Se removed
          else if (next.length < prev.length) {
              // Find removed ID
              const remainingIds = new Set(next.map(e => e.id));
              const removed = prev.find(e => !remainingIds.has(e.id));
              if (removed) {
                  sendSyncMessage({ type: 'REMOVE_ELEMENT', payload: removed.id });
              }
          }
          // Updates (Move/Resize) are harder to track purely via setElements array diff without a specific action event
          // For now, this syncs adds/removes. Move/Resize sync typically requires the Whiteboard component to emit events.
          
          return next;
      });
  };

  const handleClear = () => {
    if (window.confirm("Limpar a tela?")) {
        setElements([]);
        setUndoStack([]);
        sendSyncMessage({ type: 'CLEAR_BOARD' });
    }
  };

  const handleImportPdf = async (file: File) => {
    if (!file || file.type !== 'application/pdf') return;
    setIsLoadingPdf(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
      const newElements: ImageElement[] = [];
      let currentY = 50; 

      for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) continue;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const imgData = canvas.toDataURL('image/png');
        const img = new Image();
        img.src = imgData;
        await new Promise((r) => img.onload = r);

        const el: ImageElement = {
            type: 'image',
            id: `pdf-${Date.now()}-${i}`,
            image: img,
            src: imgData, // Important for sync
            x: 100, y: currentY,
            width: viewport.width / 2, height: viewport.height / 2,
            locked: false
        };
        newElements.push(el);
        currentY += (viewport.height / 2) + 20;
      }
      
      // Add one by one to trigger sync
      setElements(prev => [...prev, ...newElements]);
      
      // Hacky batch sync for PDF
      newElements.forEach(el => {
          sendSyncMessage({ type: 'ADD_ELEMENT', payload: { ...el, image: undefined } });
      });

      setTool('select'); 
    } catch (error) {
      console.error('Erro PDF:', error);
      alert('Erro ao processar PDF.');
    } finally {
      setIsLoadingPdf(false);
    }
  };

  // --- Render: Lobby ---

  if (connectionState === 'disconnected' || (connectionState === 'connecting' && role === 'host' && !connRef.current)) {
      return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4 font-sans text-slate-800">
              <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg transform -rotate-6">
                     <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" /></svg>
                  </div>
                  
                  <h1 className="text-2xl font-bold">Aplicativo do Profe. Gilson Antônio</h1>
                  
                  {!role ? (
                      <div className="grid grid-cols-2 gap-4">
                          <button 
                            onClick={() => initializePeer('host')}
                            className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all group"
                          >
                              <span className="text-3xl mb-2 group-hover:scale-110 transition-transform">👨‍🏫</span>
                              <span className="font-semibold text-slate-700">Iniciar Aula</span>
                              <span className="text-xs text-slate-500 mt-1">Sou o Professor</span>
                          </button>
                          <button 
                            onClick={() => initializePeer('guest')}
                            className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-xl hover:border-green-500 hover:bg-green-50 transition-all group"
                          >
                              <span className="text-3xl mb-2 group-hover:scale-110 transition-transform">👨‍🎓</span>
                              <span className="font-semibold text-slate-700">Entrar na Aula</span>
                              <span className="text-xs text-slate-500 mt-1">Sou o Aluno</span>
                          </button>
                      </div>
                  ) : role === 'host' ? (
                      <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                          <p className="text-slate-600">Compartilhe este código com o aluno:</p>
                          {myPeerId ? (
                              <div className="bg-slate-100 p-4 rounded-lg font-mono text-xl tracking-wider select-all border border-slate-200">
                                  {myPeerId}
                              </div>
                          ) : (
                              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                          )}
                          <p className="text-xs text-slate-400">Aguardando o aluno conectar...</p>
                          <button onClick={() => { setRole(null); peerRef.current?.destroy(); }} className="text-sm text-red-500 hover:underline">Cancelar</button>
                      </div>
                  ) : (
                      <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                          <p className="text-slate-600">Insira o código do professor:</p>
                          <input 
                            type="text" 
                            className="w-full p-3 border border-slate-300 rounded-lg text-center font-mono uppercase focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Ex: abc-123-xyz"
                            value={remotePeerIdInput}
                            onChange={e => setRemotePeerIdInput(e.target.value)}
                          />
                          <button 
                            onClick={connectToHost}
                            disabled={!remotePeerIdInput}
                            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                              Entrar na Sala
                          </button>
                          <button onClick={() => { setRole(null); peerRef.current?.destroy(); }} className="text-sm text-red-500 hover:underline">Voltar</button>
                      </div>
                  )}
                  
                  {/* Local Video Preview in Lobby */}
                  <div className="mt-8 pt-8 border-t border-slate-100">
                      <p className="text-xs text-slate-400 mb-2">Preview da Câmera</p>
                      <div className="w-32 h-24 bg-slate-900 rounded-lg mx-auto overflow-hidden shadow-inner relative">
                           <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover transform scale-x-[-1]" />
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  // --- Render: Main App ---

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-white">
      <h1 className="sr-only">Sala de Aula</h1>
      
      {isLoadingPdf && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="bg-white p-4 rounded-xl shadow-xl flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-slate-700 font-medium">Sincronizando PDF...</span>
            </div>
        </div>
      )}

      <Whiteboard
        tool={tool}
        color={color}
        lineWidth={lineWidth}
        elements={elements}
        setElements={handleSetElements}
        setUndoStack={setUndoStack}
      />
      
      {/* Sidebar de Videochamada */}
      <div className="absolute top-4 right-4 flex flex-col gap-3 z-10 w-[240px] md:w-[280px]">
           {/* Vídeo Remoto (Aluno ou Professor) */}
           <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden shadow-lg border border-zinc-800 flex items-center justify-center">
              <span className="absolute top-2 left-2 text-xs text-white/50 font-medium bg-black/50 px-1.5 py-0.5 rounded">
                  {role === 'host' ? 'Aluno' : 'Professor'}
              </span>
              {!remoteStream && (
                 <div className="text-zinc-500 flex flex-col items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center animate-pulse">
                        ⌛
                    </div>
                    <span className="text-xs">Conectando vídeo...</span>
                 </div>
              )}
              <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline
                  className="w-full h-full object-cover"
              />
           </div>

           {/* Vídeo Local (Você) */}
           <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden shadow-lg border border-zinc-800">
               <span className="absolute top-2 left-2 text-xs text-white/50 font-medium bg-black/50 px-1.5 py-0.5 rounded">Você</span>
               {!isCamOn && (
                   <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
                       <span className="text-sm">Câmera desligada</span>
                   </div>
               )}
               <video 
                ref={localVideoRef} 
                autoPlay 
                muted 
                playsInline 
                className={`w-full h-full object-cover transform scale-x-[-1] ${!isCamOn ? 'invisible' : ''}`} 
               />
           </div>

           {/* Controles da Chamada */}
           <div className="flex justify-center gap-2 bg-white/90 backdrop-blur-md p-2 rounded-xl shadow-lg border border-slate-200">
               <button 
                onClick={() => setIsCamOn(!isCamOn)}
                className={`p-2 rounded-full transition-colors ${!isCamOn ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
               >
                   {isCamOn ? <CameraIcon className="w-5 h-5" /> : <CameraOffIcon className="w-5 h-5" />}
               </button>

               <button 
                onClick={() => setIsMicOn(!isMicOn)}
                className={`p-2 rounded-full transition-colors ${!isMicOn ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
               >
                   {isMicOn ? <MicIcon className="w-5 h-5" /> : <MicOffIcon className="w-5 h-5" />}
               </button>

               <div className="w-px bg-slate-200 mx-1"></div>

               <button 
                onClick={() => window.location.reload()}
                className="p-2 rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                title="Sair"
               >
                   <ExitIcon className="w-5 h-5" />
               </button>
           </div>
      </div>

      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        lineWidth={lineWidth}
        setLineWidth={setLineWidth}
        undo={() => {}} // Undo sync logic is complex, disabled for MVP sync
        redo={() => {}} 
        clear={handleClear}
        onImportPdf={handleImportPdf}
        canUndo={canUndo}
        canRedo={canRedo}
      />
    </div>
  );
};

export default App;
