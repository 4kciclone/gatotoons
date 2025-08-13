// ~/projeto-manga-v2/backend/server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');
const db = require('./database.js');
const path = require('path');
const fs = require('fs');

const app = express();
const port = 3001;

// Middlewares
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuração do Upload (VERSÃO ROBUSTA)
const tempUploadDir = 'temp_uploads';
const finalUploadDir = 'uploads';
const capasDir = path.join(finalUploadDir, 'capas');

fs.mkdirSync(tempUploadDir, { recursive: true });
fs.mkdirSync(capasDir, { recursive: true });
fs.mkdirSync(path.join(finalUploadDir, 'capitulos'), { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, tempUploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g, '_'))
});
const upload = multer({ storage: storage });

// --- Rotas da API ---

// ROTA PARA ADICIONAR UMA NOVA OBRA
app.post('/api/obras', upload.fields([
    { name: 'capa', maxCount: 1 }, 
    { name: 'banner', maxCount: 1 }, // Adicionado campo de banner
    { name: 'capitulo_zip', maxCount: 1 }
]), (req, res) => {
    const { titulo, sinopse, generos, tags, status, numero_capitulo } = req.body;
    
    if (!req.files || !req.files.capa || !req.files.capitulo_zip) {
        return res.status(400).json({ error: "Capa e arquivo Zip do primeiro capítulo são obrigatórios." });
    }
    const capaFile = req.files.capa[0];
    const bannerFile = req.files.banner ? req.files.banner[0] : null; // Banner é opcional
    const capituloZipFile = req.files.capitulo_zip[0];

    if (!titulo || !status || !numero_capitulo) {
        return res.status(400).json({ error: "Campos de Título, Status e Número do Capítulo são obrigatórios." });
    }

    // Processar a capa
    const slug = titulo.toLowerCase().replace(/\s/g, '-').replace(/[^\w-]+/g, '');
    const finalCapaPath = path.join(__dirname, capasDir, capaFile.filename);
    try {
        fs.renameSync(capaFile.path, finalCapaPath);
    } catch (renameError) {
        console.error("ERRO AO MOVER ARQUIVO DE CAPA:", renameError);
        return res.status(500).json({ error: "Falha ao processar o upload da capa." });
    }
    const capaUrl = `/uploads/capas/${capaFile.filename}`;

    // Processar o banner (se existir)
    let bannerUrl = null;
    if (bannerFile) {
        const finalBannerPath = path.join(__dirname, capasDir, bannerFile.filename);
        try {
            fs.renameSync(bannerFile.path, finalBannerPath);
            bannerUrl = `/uploads/capas/${bannerFile.filename}`;
        } catch (renameError) {
            console.error("ERRO AO MOVER ARQUIVO DE BANNER:", renameError);
            // Continua mesmo se o banner falhar, pois é opcional
        }
    }

    // Inserir a Obra no DB
    const obraSql = `INSERT INTO obras (titulo, slug, sinopse, generos, tags, status, capa_url, banner_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(obraSql, [titulo, slug, sinopse, generos, tags, status, capaUrl, bannerUrl], function (err) {
        if (err) {
            console.error("ERRO AO INSERIR OBRA NO DB:", err);
            return res.status(500).json({ error: err.message });
        }
        
        const obraId = this.lastID;

        // Inserir o Capítulo no DB
        const capituloSql = `INSERT INTO capitulos (obra_id, numero_capitulo) VALUES (?, ?)`;
        db.run(capituloSql, [obraId, numero_capitulo], function(err) {
            if (err) {
                console.error("ERRO AO INSERIR CAPITULO NO DB:", err);
                return res.status(500).json({ error: err.message });
            }
            
            const capituloId = this.lastID;
            const capituloDir = path.join(__dirname, 'uploads', 'capitulos', obraId.toString(), capituloId.toString());
            fs.mkdirSync(capituloDir, { recursive: true });

            // Descompactar o Zip e inserir páginas no DB
            try {
                const zip = new AdmZip(capituloZipFile.path);
                const zipEntries = zip.getEntries();
                if (zipEntries.length === 0) throw new Error("O arquivo ZIP está vazio ou corrompido.");

                let pageCounter = 1;
                zipEntries.forEach((entry) => {
                    if (entry.isDirectory) return;

                    const pageFileName = path.basename(entry.entryName);
                    const pagePath = path.join(capituloDir, pageFileName);
                    fs.writeFileSync(pagePath, entry.getData());
                    const imageUrl = `/uploads/capitulos/${obraId}/${capituloId}/${pageFileName}`;
                    db.run('INSERT INTO paginas (capitulo_id, numero_pagina, imagem_url) VALUES (?, ?, ?)', [capituloId, pageCounter, imageUrl]);
                    pageCounter++;
                });
                 
                fs.unlinkSync(capituloZipFile.path);
                res.status(201).json({ message: "Obra e capítulo adicionados com sucesso!", slug: slug });

            } catch (zipError) {
                console.error("ERRO AO PROCESSAR ZIP:", zipError);
                res.status(500).json({ error: "Erro ao processar o arquivo zip.", details: zipError.message });
            }
        });
    });
});

// ROTA PARA ADICIONAR UM NOVO CAPÍTULO
app.post('/api/capitulos', upload.single('capitulo_zip'), (req, res) => {
    // ... (código existente)
});

// --- ROTAS DE BUSCA ---
app.get('/api/obras', (req, res) => {
    db.all("SELECT * FROM obras ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});


app.get('/api/obras/:slug', (req, res) => {
  const { slug } = req.params; // Pega o "slug" da URL

  const sqlObra = "SELECT * FROM obras WHERE slug = ?";
  // 1. Busca os detalhes da obra principal
  db.get(sqlObra, [slug], (err, obra) => {
    if (err) {
      return res.status(500).json({ error: "Erro no servidor ao buscar a obra." });
    }
    // Se nenhuma obra for encontrada, retorna um erro 404
    if (!obra) {
      return res.status(404).json({ error: "Obra não encontrada." });
    }

    // 2. Se a obra foi encontrada, busca todos os capítulos associados a ela
    // Ordenamos por número do capítulo de forma decrescente para mostrar os mais novos primeiro
    const sqlCapitulos = "SELECT id, numero_capitulo, created_at FROM capitulos WHERE obra_id = ? ORDER BY CAST(numero_capitulo AS REAL) DESC";
    db.all(sqlCapitulos, [obra.id], (err, capitulos) => {
      if (err) {
        return res.status(500).json({ error: "Erro no servidor ao buscar os capítulos." });
      }

      // 3. Envia a resposta com os detalhes da obra e a lista de capítulos
      res.json({ obra, capitulos });
    });
  });
});



app.get('/api/capitulos/:id/paginas', (req, res) => {
  const { id } = req.params; // Pega o ID do capítulo da URL

  // Busca todas as páginas do capítulo, ordenadas pelo número da página
  const sql = "SELECT id, imagem_url, numero_pagina FROM paginas WHERE capitulo_id = ? ORDER BY numero_pagina ASC";
  
  db.all(sql, [id], (err, paginas) => {
    if (err) {
      return res.status(500).json({ error: "Erro no servidor ao buscar as páginas." });
    }
    if (!paginas || paginas.length === 0) {
      return res.status(404).json({ error: "Nenhuma página encontrada para este capítulo." });
    }

    // Envia a lista de páginas como resposta
    res.json(paginas);
  });
});


app.post('/api/capitulos', upload.single('capitulo_zip'), (req, res) => {
  const { obra_id, numero_capitulo } = req.body;
  const capituloZipFile = req.file;

  // Validação
  if (!obra_id || !numero_capitulo || !capituloZipFile) {
    return res.status(400).json({ error: "Dados incompletos. ID da Obra, Número do Capítulo e Arquivo Zip são necessários." });
  }

  // 1. Inserir o novo capítulo no DB
  const capituloSql = `INSERT INTO capitulos (obra_id, numero_capitulo) VALUES (?, ?)`;
  db.run(capituloSql, [obra_id, numero_capitulo], function(err) {
    if (err) {
      console.error("ERRO AO INSERIR NOVO CAPITULO NO DB:", err);
      return res.status(500).json({ error: err.message });
    }
    
    const capituloId = this.lastID;
    const capituloDir = path.join(__dirname, 'uploads', 'capitulos', obra_id.toString(), capituloId.toString());
    fs.mkdirSync(capituloDir, { recursive: true });

    // 2. Descompactar o Zip e inserir as páginas (lógica idêntica à anterior)
    try {
      const zip = new AdmZip(capituloZipFile.path);
      const zipEntries = zip.getEntries();
      
      let pageCounter = 1;
      zipEntries.forEach((entry) => {
        if (entry.isDirectory) return;

        const pageFileName = path.basename(entry.entryName);
        const pagePath = path.join(capituloDir, pageFileName);
        fs.writeFileSync(pagePath, entry.getData());
        
        const imageUrl = `/uploads/capitulos/${obra_id}/${capituloId}/${pageFileName}`;
        db.run('INSERT INTO paginas (capitulo_id, numero_pagina, imagem_url) VALUES (?, ?, ?)', [capituloId, pageCounter, imageUrl]);
        pageCounter++;
      });
      
      fs.unlinkSync(capituloZipFile.path);
      res.status(201).json({ message: "Novo capítulo adicionado com sucesso!", capituloId: capituloId });

    } catch (zipError) {
      console.error("ERRO AO PROCESSAR ZIP DO NOVO CAPÍTULO:", zipError);
      res.status(500).json({ error: "Erro ao processar o arquivo zip.", details: zipError.message });
    }
  });
});

app.get('/api/capitulos/:id/navigation', (req, res) => {
  const { id: currentChapterId } = req.params;

  // 1. Primeiro, descobrir a qual obra este capítulo pertence.
  const getObraIdSql = `SELECT obra_id FROM capitulos WHERE id = ?`;
  db.get(getObraIdSql, [currentChapterId], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: "Capítulo não encontrado ou não associado a uma obra." });
    }
    const obraId = row.obra_id;

    // 2. Agora, buscar todos os capítulos daquela obra, em ordem.
    const getChaptersSql = `
      SELECT c.id, c.numero_capitulo, o.slug 
      FROM capitulos c
      JOIN obras o ON c.obra_id = o.id
      WHERE c.obra_id = ? 
      ORDER BY CAST(c.numero_capitulo AS REAL) ASC
    `;
    db.all(getChaptersSql, [obraId], (err, allChapters) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao buscar capítulos da obra." });
      }

      // 3. Encontrar o índice do capítulo atual na lista.
      const currentIndex = allChapters.findIndex(ch => ch.id.toString() === currentChapterId);
      if (currentIndex === -1) {
        return res.status(404).json({ error: "Capítulo não encontrado na lista da obra." });
      }
      
      // 4. Determinar o capítulo anterior e o próximo.
      const previousChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
      const nextChapter = currentIndex < allChapters.length - 1 ? allChapters[currentIndex + 1] : null;
      const obraSlug = allChapters[0].slug; // O slug é o mesmo para todos

      // 5. Enviar a resposta.
      res.json({
        previous: previousChapter,
        next: nextChapter,
        obraSlug: obraSlug
      });
    });
  });
});
// --- Inicialização do Servidor ---
app.listen(port, () => {
    console.log(`Servidor back-end rodando com nodemon em http://localhost:${port}`);
});