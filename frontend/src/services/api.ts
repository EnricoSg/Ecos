import axios from 'axios';

export const api = axios.create({
    baseURL: 'http://localhost:3000/api/v1',
    timeout: 10000, // se o back demorar mais de 10s, ele cancela automaticamente
});

api.interceptors.request.use((config) => {  //tokens nas requests para garantir o RNF03
    const token = localStorage.getItem('@Ecos:token');

    if(token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
});