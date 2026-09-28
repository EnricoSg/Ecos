--
-- PostgreSQL database dump
--



-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

-- Started on 2026-09-24 16:35:57

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 228 (class 1259 OID 16461)
-- Name: alerta; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alerta (
    id integer NOT NULL,
    anomalia_id integer NOT NULL,
    status character varying(20) DEFAULT 'PENDENTE'::character varying NOT NULL,
    mensagem character varying(255),
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    data_resolucao timestamp without time zone,
    CONSTRAINT chk_alerta_status CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'RESOLVIDO'::character varying])::text[])))
);


ALTER TABLE public.alerta OWNER TO postgres;

--
-- TOC entry 227 (class 1259 OID 16460)
-- Name: alerta_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.alerta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.alerta_id_seq OWNER TO postgres;

--
-- TOC entry 4963 (class 0 OID 0)
-- Dependencies: 227
-- Name: alerta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.alerta_id_seq OWNED BY public.alerta.id;


--
-- TOC entry 226 (class 1259 OID 16433)
-- Name: anomalia; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.anomalia (
    id integer NOT NULL,
    colaborador_id integer NOT NULL,
    telemetria_id integer NOT NULL,
    baseline_id integer NOT NULL,
    nivel character varying(20) NOT NULL,
    pontuacao_desvio numeric(10,2),
    data_deteccao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_anomalia_nivel CHECK (((nivel)::text = ANY ((ARRAY['BAIXO'::character varying, 'MEDIO'::character varying, 'ALTO'::character varying])::text[])))
);


ALTER TABLE public.anomalia OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16432)
-- Name: anomalia_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.anomalia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.anomalia_id_seq OWNER TO postgres;

--
-- TOC entry 4964 (class 0 OID 0)
-- Dependencies: 225
-- Name: anomalia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.anomalia_id_seq OWNED BY public.anomalia.id;


--
-- TOC entry 224 (class 1259 OID 16418)
-- Name: baseline; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.baseline (
    id integer NOT NULL,
    colaborador_id integer NOT NULL,
    media_velocidade_digitacao numeric(10,2),
    media_tempo_pausa numeric(10,2),
    media_velocidade_mouse numeric(10,2),
    data_calculo timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.baseline OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16417)
-- Name: baseline_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.baseline_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.baseline_id_seq OWNER TO postgres;

--
-- TOC entry 4965 (class 0 OID 0)
-- Dependencies: 223
-- Name: baseline_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.baseline_id_seq OWNED BY public.baseline.id;


--
-- TOC entry 220 (class 1259 OID 16390)
-- Name: colaborador; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.colaborador (
    id integer NOT NULL,
    codigo_anonimo character varying(50) NOT NULL,
    setor character varying(100),
    data_cadastro timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ativo boolean DEFAULT true
);


ALTER TABLE public.colaborador OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16389)
-- Name: colaborador_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.colaborador_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.colaborador_id_seq OWNER TO postgres;

--
-- TOC entry 4966 (class 0 OID 0)
-- Dependencies: 219
-- Name: colaborador_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.colaborador_id_seq OWNED BY public.colaborador.id;


--
-- TOC entry 222 (class 1259 OID 16403)
-- Name: telemetria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.telemetria (
    id integer NOT NULL,
    colaborador_id integer NOT NULL,
    velocidade_digitacao numeric(10,2),
    tempo_medio_pausa numeric(10,2),
    velocidade_mouse numeric(10,2),
    data_coleta timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_telemetria_valores_positivos CHECK (((velocidade_digitacao >= (0)::numeric) AND (tempo_medio_pausa >= (0)::numeric) AND (velocidade_mouse >= (0)::numeric)))
);


ALTER TABLE public.telemetria OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16402)
-- Name: telemetria_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.telemetria_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.telemetria_id_seq OWNER TO postgres;

--
-- TOC entry 4967 (class 0 OID 0)
-- Dependencies: 221
-- Name: telemetria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.telemetria_id_seq OWNED BY public.telemetria.id;


--
-- TOC entry 4784 (class 2604 OID 16464)
-- Name: alerta id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta ALTER COLUMN id SET DEFAULT nextval('public.alerta_id_seq'::regclass);


--
-- TOC entry 4782 (class 2604 OID 16436)
-- Name: anomalia id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.anomalia ALTER COLUMN id SET DEFAULT nextval('public.anomalia_id_seq'::regclass);


--
-- TOC entry 4780 (class 2604 OID 16421)
-- Name: baseline id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.baseline ALTER COLUMN id SET DEFAULT nextval('public.baseline_id_seq'::regclass);


--
-- TOC entry 4775 (class 2604 OID 16393)
-- Name: colaborador id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.colaborador ALTER COLUMN id SET DEFAULT nextval('public.colaborador_id_seq'::regclass);


--
-- TOC entry 4778 (class 2604 OID 16406)
-- Name: telemetria id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telemetria ALTER COLUMN id SET DEFAULT nextval('public.telemetria_id_seq'::regclass);


--
-- TOC entry 4803 (class 2606 OID 16471)
-- Name: alerta alerta_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT alerta_pkey PRIMARY KEY (id);


--
-- TOC entry 4800 (class 2606 OID 16444)
-- Name: anomalia anomalia_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.anomalia
    ADD CONSTRAINT anomalia_pkey PRIMARY KEY (id);


--
-- TOC entry 4798 (class 2606 OID 16426)
-- Name: baseline baseline_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.baseline
    ADD CONSTRAINT baseline_pkey PRIMARY KEY (id);


--
-- TOC entry 4791 (class 2606 OID 16401)
-- Name: colaborador colaborador_codigo_anonimo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.colaborador
    ADD CONSTRAINT colaborador_codigo_anonimo_key UNIQUE (codigo_anonimo);


--
-- TOC entry 4793 (class 2606 OID 16399)
-- Name: colaborador colaborador_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.colaborador
    ADD CONSTRAINT colaborador_pkey PRIMARY KEY (id);


--
-- TOC entry 4796 (class 2606 OID 16411)
-- Name: telemetria telemetria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telemetria
    ADD CONSTRAINT telemetria_pkey PRIMARY KEY (id);


--
-- TOC entry 4804 (class 1259 OID 24585)
-- Name: idx_alerta_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alerta_status ON public.alerta USING btree (status);


--
-- TOC entry 4801 (class 1259 OID 24584)
-- Name: idx_anomalia_colaborador_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_anomalia_colaborador_data ON public.anomalia USING btree (colaborador_id, data_deteccao);


--
-- TOC entry 4794 (class 1259 OID 24583)
-- Name: idx_telemetria_colaborador_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_telemetria_colaborador_data ON public.telemetria USING btree (colaborador_id, data_coleta);


--
-- TOC entry 4810 (class 2606 OID 16472)
-- Name: alerta fk_alerta_anomalia; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerta
    ADD CONSTRAINT fk_alerta_anomalia FOREIGN KEY (anomalia_id) REFERENCES public.anomalia(id);


--
-- TOC entry 4807 (class 2606 OID 16455)
-- Name: anomalia fk_anomalia_baseline; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.anomalia
    ADD CONSTRAINT fk_anomalia_baseline FOREIGN KEY (baseline_id) REFERENCES public.baseline(id);


--
-- TOC entry 4808 (class 2606 OID 16445)
-- Name: anomalia fk_anomalia_colaborador; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.anomalia
    ADD CONSTRAINT fk_anomalia_colaborador FOREIGN KEY (colaborador_id) REFERENCES public.colaborador(id);


--
-- TOC entry 4809 (class 2606 OID 16450)
-- Name: anomalia fk_anomalia_telemetria; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.anomalia
    ADD CONSTRAINT fk_anomalia_telemetria FOREIGN KEY (telemetria_id) REFERENCES public.telemetria(id);


--
-- TOC entry 4806 (class 2606 OID 16427)
-- Name: baseline fk_baseline_colaborador; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.baseline
    ADD CONSTRAINT fk_baseline_colaborador FOREIGN KEY (colaborador_id) REFERENCES public.colaborador(id);


--
-- TOC entry 4805 (class 2606 OID 16412)
-- Name: telemetria fk_telemetria_colaborador; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.telemetria
    ADD CONSTRAINT fk_telemetria_colaborador FOREIGN KEY (colaborador_id) REFERENCES public.colaborador(id);


-- Completed on 2026-09-24 16:35:58

--
-- PostgreSQL database dump complete
--



