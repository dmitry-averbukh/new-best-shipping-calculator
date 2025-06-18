// script.js

const clients = [];
let nextClientId = 0;

// 1. Обработка кнопки «Обробити»
document.getElementById('processBtn').addEventListener('click', async () => {
    const fileInput  = document.getElementById('pdfFile');
    const startLabel = parseInt(document.getElementById('startLabel').value,10) || 1;
    const endLabel   = parseInt(document.getElementById('endLabel').value,10) || Infinity;
    const file       = fileInput.files[0];
    if (!file) return alert('Оберіть PDF-файл');

    // Читаем PDF
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

    // Собираем текст
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ') + '\n';
    }

    // Парсим все записи
    const all = extractEntries(text);
    const entries = all.slice(startLabel - 1, endLabel);

    // Создаем клиента
    const client = {
        id: nextClientId++,
        filename: file.name,
        entries: entries.map(e => ({ track: e.track, weight: e.weight })),
        postCost: null,
        overCount: 0,
        dom: {},
        messageText: ''
    };
    clients.push(client);

    renderClientCard(client);
    updateSummaries();

    fileInput.value = '';
});

// 2. Парсинг треков и весов
function extractEntries(text) {
    const weightRe   = /(\d+(?:[\.,]\d+)?)\s?kg/gi;
    const trackRe    = /\b[A-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\s?[A-Z]{2}\b/g;

    // Збираємо всі знайдені ваги
    let rawWeights = [...text.matchAll(weightRe)].map(m =>
        parseFloat(m[1].replace(',', '.'))
    );
    // Якщо ваг більше треків — беремо тільки кожну другу
    // (можна також перевіряти: rawWeights.length >= tracks.length*2)
    const weights = rawWeights.filter((_, i) => i % 2 === 0);

    // Трек-номери, без пробілів
    const tracks = [...text.matchAll(trackRe)].map(m =>
        m[0].replace(/\s+/g, '')
    );

    // Нарізаємо під фактичну кількість треків
    const count = Math.min(tracks.length, weights.length);
    const result = [];
    for (let i = 0; i < count; i++) {
        result.push({
            track: tracks[i],
            weight: weights[i]
        });
    }
    return result;
}

// 3. Рендер карточки клиента
function renderClientCard(client) {
    const container = document.getElementById('cardContainer');
    const col = document.createElement('div');
    col.className = 'client-card';

    col.innerHTML = `
    <div class="card shadow-sm mb-4" data-client-id="${client.id}">
      <div class="card-header bg-primary text-white">${client.filename}</div>
      <div class="card-body p-2">
        <table class="table table-bordered table-sm mb-2">
          <thead class="table-light">
            <tr>
              <th>#</th><th>Трек-номер</th><th>Вага (кг)</th>
              <th>Послуги (грн)</th><th>Наташі (грн)</th><th>Дія</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
        <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
          <input type="number" placeholder="Сума за пошту" class="form-control" style="max-width:140px;">
          <select class="form-select" style="max-width:100px;">
            ${[...Array(11).keys()].map(n=>`<option value="${n}">${n}</option>`).join('')}
          </select>
          <button class="btn btn-outline-secondary btn-sm">Додати рядок</button>
          <button class="btn btn-outline-secondary btn-sm">Об’єднати</button>
          <button class="btn btn-outline-primary btn-sm">Копіювати повідомлення</button>
          <button class="btn btn-outline-danger btn-sm">Видалити таблицю</button>
        </div>
        <pre class="small text-muted mb-0"></pre>
      </div>
    </div>
  `;
    container.appendChild(col);

    // Сохраняем ссылки
    const tbody     = col.querySelector('tbody');
    const [postInput, overSel, btnAdd, btnMerge, btnCopy, btnDelTbl] =
        col.querySelectorAll('.card-body > .d-flex button, .card-body > .d-flex input, .card-body > .d-flex select');
    const msgDiv    = col.querySelector('pre');

    client.dom = { col, tbody, postInput, overSel, btnAdd, btnMerge, btnCopy, btnDelTbl, msgDiv };

    // Хендлеры
    postInput.onchange = () => { client.postCost = parseFloat(postInput.value)||0; updateClient(client); updateSummaries(); };
    overSel.onchange   = () => { client.overCount = +overSel.value; updateClient(client); updateSummaries(); };
    btnAdd.onclick     = () => { client.entries.push({track:'',weight:null}); updateClient(client); updateSummaries(); };
    btnMerge.onclick   = () => { mergeWithNext(client.id); };
    btnCopy.onclick    = () => { navigator.clipboard.writeText(client.messageText); };
    btnDelTbl.onclick  = () => { deleteClient(client.id); };

    updateClient(client);
}

// 4. Обновление одной карточки
function updateClient(client) {
    const { tbody, postInput, overSel, msgDiv } = client.dom;
    tbody.innerHTML = '';

    let sumService = 0, sumNatasha = 0;

    client.entries.forEach((e, idx) => {
        const tr = document.createElement('tr');
        // №
        tr.innerHTML = `
      <td>${idx+1}</td>
      <td>${e.track||'—'}</td>
      <td>${e.weight!=null ? e.weight.toFixed(3) : ''}</td>
      <td></td><td></td><td></td>
    `;
        // Ввод веса
        if (e.weight == null) {
            const inp = document.createElement('input');
            inp.type='number'; inp.step='0.001'; inp.className='form-control form-control-sm';
            inp.onkeydown = ev => { if(ev.key==='Enter'){ e.weight=+inp.value||0; updateClient(client); updateSummaries(); } };
            inp.onblur    = () => { e.weight=+inp.value||0; updateClient(client); updateSummaries(); };
            tr.cells[2].appendChild(inp);
            tr.classList.add('table-danger');
        } else {
            tr.cells[2].textContent = e.weight.toFixed(3);
        }

        // Расчёт по весу
        let service=0, natasha=0;
        if (e.weight!=null) {
            const g = Math.round(e.weight*1000);
            if      (g<=250)   service=20;
            else if (g<=510)   service=150;
            else if (g<=1010)  service=200;
            else /*<=2000*/    service=250;
            sumService += service;
            if      (g<=289)   natasha=0;
            else if (g<=540)   natasha=50;
            else if (g<=1040)  natasha=100;
            else               natasha=150;
            sumNatasha += natasha;
            tr.classList.remove('table-danger');
        }

        tr.cells[3].textContent = service;
        tr.cells[4].textContent = natasha;

        // Действие: удалить строку
        const btnDel = document.createElement('button');
        btnDel.className='btn btn-sm btn-danger';
        btnDel.textContent='×';
        btnDel.onclick = ()=>{ client.entries.splice(idx,1); updateClient(client); updateSummaries(); };
        tr.cells[5].appendChild(btnDel);

        tbody.appendChild(tr);
    });

    // Добавляем перевіси только к сумме за услуги
    sumService += client.overCount * 50;

    // Подсветка почты
    postInput.classList.toggle('is-invalid', !client.postCost);

    // Формируем сообщение
    const post = client.postCost||0;
    client.messageText =
        `За пошту: ${post} грн\n` +
        `За послуги: ${sumService} грн\n` +
        `Разом: ${post + sumService} грн`;
    msgDiv.textContent = client.messageText;
}

// 5. Объединение с соседней таблицей (in-place)
function mergeWithNext(id) {
    const idx = clients.findIndex(c=>c.id===id);
    if (idx<0||idx===clients.length-1) { alert('Немає наступної таблиці'); return; }
    const cur = clients[idx], nxt = clients[idx+1];
    // Объединяем данные
    cur.entries   = cur.entries.concat(nxt.entries);
    cur.postCost  = (cur.postCost||0) + (nxt.postCost||0);
    cur.overCount += nxt.overCount;
    // Удаляем вторую карточку
    nxt.dom.col.remove();
    clients.splice(idx+1,1);
    // Обновляем текущую
    updateClient(cur);
    updateSummaries();
}

// 6. Удаление всей таблицы
function deleteClient(id) {
    const idx = clients.findIndex(c=>c.id===id);
    if (idx<0) return;
    clients[idx].dom.col.remove();
    clients.splice(idx,1);
    updateSummaries();
}

// 7. Обновление сводных карточек
function updateSummaries() {
    // Наташа полная
    const natFull = clients.reduce((S,c)=>
            S + c.entries.reduce((s,e)=>{
                if (e.weight==null) return s;
                const g=Math.round(e.weight*1000);
                if      (g<=289)  return s;
                if      (g<=540)  return s+50;
                if      (g<=1040) return s+100;
                return s+150;
            },0)
        ,0);
    document.getElementById('natashaFull').textContent = `${natFull} грн`;

    // –20% editable
    const natInp = document.getElementById('natashaReduced');
    if (!natInp.dataset.manual) natInp.value = Math.round(natFull*0.8);
    natInp.onchange = ()=>{ natInp.dataset.manual='1'; updateSummaries(); };
    const natRed = +natInp.value||0;

    // Максим
    let small=0, large=0, over=0;
    clients.forEach(c=>{
        c.entries.forEach(e=>{
            if(e.weight!=null) {
                const g=Math.round(e.weight*1000);
                if(g<=250) small++; else large++;
            }
        });
        over += c.overCount;
    });
    const maxSum = small*10 + large*25 + over*20;
    document.getElementById('maximStats').textContent =
        `${small} малих, ${large} великих, ${over} перевісів`;
    document.getElementById('maximTotal').textContent = `${maxSum} грн`;

    // Общая почта
    const totPost = clients.reduce((s,c)=>s+(c.postCost||0),0);
    document.getElementById('totalShippingCost').textContent = `${totPost} грн`;

    // Сумма услуг всех
    const totSvc = clients.reduce((S,c)=>
            S + c.entries.reduce((s,e)=>{
                if(e.weight==null) return s;
                const g=Math.round(e.weight*1000);
                let svc=0;
                if      (g<=250)   svc=20;
                else if (g<=510)   svc=150;
                else if (g<=1010)  svc=200;
                else                svc=250;
                return s+svc;
            },0) + c.overCount*50
        ,0);
    const totClient = totPost + totSvc;
    document.getElementById('totalClientSum').textContent = `${totClient} грн`;

    // Финальный
    const fin = (totClient - totPost - natRed - maxSum)/2;
    document.getElementById('finalProfit').textContent = `${Math.round(fin)} грн`;
}

// Копия сообщения Максиму
document.getElementById('copyMaximBtn').onclick = ()=>{
    const stats = document.getElementById('maximStats').textContent;
    const sum   = document.getElementById('maximTotal').textContent;
    navigator.clipboard.writeText(`${stats}\nСума: ${sum}`);
};
