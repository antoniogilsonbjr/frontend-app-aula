import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react( )],
  // Adiciona esta seção para otimizar o PeerJS
  optimizeDeps: {
    include: ['peerjs'],
  },
})
