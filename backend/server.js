// Importações
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const slugify = require('slugify');

const { initializeDatabase } = require('./database');

// Constantes do Ambiente
const PORT = process.env.PORT || 3001;
const UPLOADS_DIR = process.env.UPLOADS_DIR || 'uploads';

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Salva zips em um temp, e imagens direto nos uploads
        const dest = file.fieldname === 'capitulo_zip' ? path.join(__dirname, 'temp_zips') : path.join(__dirname, UPLOADS_DIR);
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// Função principal assíncrona para iniciar o servidor
async function startServer() {
    try {
        console.log('Inicializando o banco de dados...');
        const { dbRun, dbGet, dbAll } = await initializeDatabase();
        console.log('Banco de dados pronto.');

        const app = express();

        // Middlewares
        app.use(cors()); // Permite requisições de outras origens (seu frontend)
        app.use(express.json()); // Para parsear JSON no corpo das requisições
        app.use(`/${UPLOADS_DIR}`, express.static(path.join(__dirname, UPLOADS_DIR))); // Servir arquivos estáticos

        // --- ROTAS DA API ---

        // GET /api/obras - Listar obras com paginação e filtros
        app.get('/api/obras', async (req, res) => {
            const { page = 1, limit = 10, titulo, tipo } = req.query;
            const offset = (page - 1) * limit;

            let query = `
                SELECT 
                    o.*,
                    (SELECT GROUP_CONCAT(g.nome) FROM obra_generos og JOIN generos g ON og.genero_id = g.id WHERE og.obra_id = o.id) as generos,
                    (SELECT GROUP_CONCAT(t.nome) FROM obra_tags ot JOIN tags t ON ot.tag_id = t.id WHERE ot.obra_id = o.id) as tags
                FROM obras o
                WHERE 1=1
            `;
            let params = [];
            
            if (titulo) {
                query += ' AND o.titulo LIKE ?';
                params.push(`%${titulo}%`);
            }
            if (tipo) {
                query += ' AND o.tipo = ?';
                params.push(tipo);
            }
            
            query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
            params.push(limit, offset);

            try {
                const obras = await dbAll(query, params);
                res.status(200).json(obras);
            } catch (error) {
                res.status(500).json({ error: 'Erro ao buscar obras.', details: error.message });
            }
        });

        // GET /api/obras/:slug - Detalhes de uma obra e seus capítulos
        app.get('/api/obras/:slug', async (req, res) => {
            const { slug } = req.params;
            const { userId, isVip } = req.query; // isVip é um booleano 'true' ou 'false'

            try {
                const obra = await dbGet('SELECT * FROM obras WHERE slug = ?', [slug]);
                if (!obra) {
                    return res.status(404).json({ error: 'Obra não encontrada.' });
                }

                const capitulos = await dbAll('SELECT * FROM capitulos WHERE obra_id = ? ORDER BY numero_capitulo ASC', [obra.id]);
                
                // Lógica de bloqueio de capítulo (exemplo simples)
                const isUserVip = isVip === 'true';
                const capitulosComStatus = capitulos.map(cap => {
                    let isLocked = false;
                    if (obra.is_vip && !isUserVip) {
                        // Aqui entraria a lógica de tempo, vinda da tabela 'configuracoes'
                        isLocked = true; 
                    }
                    return { ...cap, isLocked };
                });

                res.status(200).json({ ...obra, capitulos: capitulosComStatus });
            } catch (error) {
                res.status(500).json({ error: 'Erro ao buscar detalhes da obra.', details: error.message });
            }
        });

        // POST /api/obras - Criar uma nova obra
        app.post('/api/obras', upload.fields([
            { name: 'capa', maxCount: 1 },
            { name: 'banner', maxCount: 1 },
            { name: 'capitulo_zip', maxCount: 1 }
        ]), async (req, res) => {
            const { titulo, sinopse, status, tipo, titulo_alternativo, is_vip, generos, tags } = req.body;
            const capaFile = req.files.capa ? req.files.capa[0] : null;
            const bannerFile = req.files.banner ? req.files.banner[0] : null;
            const capituloZipFile = req.files.capitulo_zip ? req.files.capitulo_zip[0] : null;

            if (!titulo || !capaFile || !capituloZipFile) {
                return res.status(400).json({ error: 'Título, capa e um arquivo .zip do capítulo são obrigatórios.' });
            }

            await dbRun('BEGIN TRANSACTION');
            try {
                const slug = slugify(titulo, { lower: true, strict: true });
                const capa_url = `/${UPLOADS_DIR}/${capaFile.filename}`;
                const banner_url = bannerFile ? `/${UPLOADS_DIR}/${bannerFile.filename}` : null;

                // 1. Inserir na tabela 'obras'
                const obraResult = await dbRun(
                    'INSERT INTO obras (titulo, slug, sinopse, status, capa_url, banner_url, tipo, titulo_alternativo, is_vip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [titulo, slug, sinopse, status, capa_url, banner_url, tipo, titulo_alternativo, is_vip === 'true' ? 1 : 0]
                );
                const obraId = obraResult.lastID;

                // 2. Processar e inserir gêneros e tags (simplificado)
                // (Em um cenário real, você buscaria o ID de cada gênero/tag pelo nome)
                // ... Lógica para associar gêneros e tags ...

                // 3. Processar o ZIP do capítulo
                const numero_capitulo = 1; // Primeiro capítulo
                const capResult = await dbRun('INSERT INTO capitulos (obra_id, numero_capitulo) VALUES (?, ?)', [obraId, numero_capitulo]);
                const capituloId = capResult.lastID;

                const zip = new AdmZip(capituloZipFile.path);
                const zipEntries = zip.getEntries()
                    .filter(entry => /\.(jpg|jpeg|png|webp)$/i.test(entry.entryName))
                    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: 'base' }));

                const obraUploadDir = path.join(__dirname, UPLOADS_DIR, slug, `cap-${numero_capitulo}`);
                fs.mkdirSync(obraUploadDir, { recursive: true });

                for (let i = 0; i < zipEntries.length; i++) {
                    const entry = zipEntries[i];
                    const pageNumber = i + 1;
                    const pageExt = path.extname(entry.entryName);
                    const pageFilename = `${pageNumber}${pageExt}`;
                    const pagePath = path.join(obraUploadDir, pageFilename);
                    
                    // Extrai o arquivo da imagem para a pasta de uploads da obra/capítulo
                    fs.writeFileSync(pagePath, entry.getData());
                    const imagem_url = `/${UPLOADS_DIR}/${slug}/cap-${numero_capitulo}/${pageFilename}`;

                    await dbRun('INSERT INTO paginas (capitulo_id, numero_pagina, imagem_url) VALUES (?, ?, ?)', [capituloId, pageNumber, imagem_url]);
                }

                // Limpar arquivo zip temporário
                fs.unlinkSync(capituloZipFile.path);

                await dbRun('COMMIT');
                res.status(201).json({ message: 'Obra criada com sucesso!', obraId, slug });

            } catch (error) {
                await dbRun('ROLLBACK');
                console.error("Erro ao criar obra:", error);
                // Limpar arquivos de upload em caso de erro
                if (capaFile) fs.unlinkSync(capaFile.path);
                if (bannerFile) fs.unlinkSync(bannerFile.path);
                res.status(500).json({ error: 'Falha ao criar a obra.', details: error.message });
            }
        });


        // --- FIM DAS ROTAS ---

        app.listen(PORT, () => {
            console.log(`🚀 Servidor rodando na porta http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("Falha ao iniciar o servidor:", error);
        process.exit(1); // Encerra o processo se o DB não puder ser inicializado
    }
}

// Inicia o servidor
startServer();