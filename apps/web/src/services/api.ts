import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

export const analysisService = {
  submitAnalysis: async (data: any) => {
    const response = await api.post('/analysis', data);
    return response.data;
  },
  getStatus: async (jobId: string) => {
    const response = await api.get(`/analysis/${jobId}/status`);
    return response.data;
  },
  getResult: async (jobId: string) => {
    const response = await api.get(`/analysis/${jobId}/result`);
    return response.data;
  },
};

export const simulationService = {
  simulate: async (data: any) => {
    const response = await api.post('/api/simulation/simulate', data);
    return response.data;
  },
  compare: async (data: any) => {
    const response = await api.post('/api/simulation/compare', data);
    return response.data;
  },
};
