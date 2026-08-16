(function(){

  // ---------------- State ----------------
  let me = null;             // {id, name, username, role}
  let settings = { companyName:'Conference Ops', accentColor:'#1F6F5C', logoPath:null };
  let events = [];
  let projects = [];
  let roster = [];           // {id, name} for everyone — used to show the full attendee list to all staff
  let users = [];            // admin only — full account detail (username, role)
  let view = 'events';
  let adminTab = 'data';
  let openTravelIds = {};
  let ready = false;

  const root = document.getElementById('root');

  function showToast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(()=> t.classList.remove('show'), 2000);
  }
  function escapeHtml(s){
    return (s==null?'':s).toString().replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function fmtMoney(v){ const n=parseFloat(v); return isNaN(n)?'0':n.toLocaleString(undefined,{maximumFractionDigits:0}); }
  function fmtDate(iso){
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
  }
  function fmtDateRange(ev){
    if (ev.start_date) {
      const start = fmtDate(ev.start_date);
      const end = ev.end_date && ev.end_date !== ev.start_date ? fmtDate(ev.end_date) : '';
      return end ? `${start} – ${end}` : start;
    }
    return ev.dates || ''; // legacy free-text fallback for events created before this feature
  }
  function initials(name){ return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(); }

  async function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type':'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch('/api' + path, opts);
    if (res.status === 401) { window.location.href = '/login.html'; throw new Error('Not logged in'); }
    let data = null;
    try { data = await res.json(); } catch(e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  // ---------------- Boot ----------------
  async function boot(){
    try{
      me = await api('/auth/me');
    }catch(e){ return; } // api() already redirects on 401
    try{ settings = await api('/settings'); }catch(e){}
    document.documentElement.style.setProperty('--teal', settings.accentColor || '#1F6F5C');
    await Promise.all([loadEvents(), loadProjects(), loadRoster()]);
    if (me.role === 'admin') { try { users = await api('/admin/users'); } catch(e){} }
    ready = true;
    render();
  }

  async function loadEvents(){ events = await api('/events'); }
  async function loadProjects(){ projects = await api('/projects'); }
  async function loadRoster(){ roster = await api('/roster'); }
  async function loadUsers(){ users = await api('/admin/users'); }

  // ---------------- Render shell ----------------
  function render(){
    if (!ready) return;
    root.innerHTML = `
      <div class="app">
        ${renderNav()}
        <div class="main">${renderView()}</div>
      </div>
    `;
    attachHandlers();
  }

  function renderNav(){
    const items = [['events','Events'],['travel','My Travel'],['projects','Projects']];
    if (me.role === 'admin') items.push(['admin','Admin']);
    return `
      <div class="nav">
        <div class="brand">
          ${settings.logoPath ? `<img src="${settings.logoPath}" alt="${escapeHtml(settings.companyName)}">` : `<span class="brand-mark">${(settings.companyName||'C')[0]}</span><span class="brand-text">${escapeHtml(settings.companyName)}</span>`}
        </div>
        <div class="brand-sub">${events.length} event${events.length===1?'':'s'} · ${users.length || ''}${me.role==='admin'?' staff':''}</div>
        ${items.map(([id,label])=>`<div class="navlink ${view===id?'active':''}" data-nav="${id}"><span class="dot"></span>${label}</div>`).join('')}
        <div class="nav-user">
          <div class="nav-user-name">${escapeHtml(me.name)}</div>
          <div class="nav-user-role">${me.role}</div>
          <button data-action="logout">Log out</button>
        </div>
      </div>
    `;
  }

  function renderView(){
    if (view==='events') return renderEvents();
    if (view==='travel') return renderTravel();
    if (view==='projects') return renderProjects();
    if (view==='admin') return renderAdmin();
    return '';
  }

  // ================= EVENTS =================
  function renderEvents(){
    return `
      <div class="page-head" style="display:flex; justify-content:space-between; align-items:flex-end;">
        <div>
          <div class="eyebrow">Master list</div>
          <h1>Conferences &amp; events</h1>
          <div class="subtext">Registration fees, vendor fees, and who's attending under which project.</div>
        </div>
        <button class="btn btn-primary" data-action="new-event">+ New event</button>
      </div>
      ${events.length===0 ? `
        <div class="empty"><b>No events yet</b>Add the first conference to start tracking.</div>
      ` : `
        <div class="event-grid">
          ${events.map(ev=>{
            const attending = (ev.attendees||[]).filter(a=>a.attending);
            return `
            <div class="ticket" data-open-event="${ev.id}">
              <div class="ticket-body">
                <div class="ticket-name">${escapeHtml(ev.name)}</div>
                <div class="ticket-loc">${escapeHtml(ev.location||'Location TBD')}</div>
                ${fmtDateRange(ev) ? `<span class="ticket-dates">${escapeHtml(fmtDateRange(ev))}</span>` : ''}
              </div>
              <div class="perf"></div>
              <div class="ticket-stub">
                <div class="stub-item"><span class="label">Reg + Vendor</span><span class="value">$${fmtMoney(ev.reg_fee)} / $${fmtMoney(ev.vendor_fee)}</span></div>
                <div class="avatars">${attending.length ? attending.map(a=>`<div class="avatar" title="${escapeHtml(a.name)}">${initials(a.name)}</div>`).join('') : `<span style="color:var(--ink-soft); font-size:12px;">Unassigned</span>`}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      `}
    `;
  }

  const ATTENDEE_TYPES = [
    ['vendor', 'Vendor'],
    ['attendee', 'Attendee'],
    ['speaker', 'Speaker'],
  ];

  function openEventModal(id){
    const isNew = !id;
    const ev = isNew
      ? { id:null, name:'', location:'', start_date:'', end_date:'', website:'', reg_fee:'', vendor_fee:'', attendees: [] }
      : events.find(e=>String(e.id)===String(id));
    const attendeeMap = {};
    (ev.attendees||[]).forEach(a=>{ attendeeMap[a.userId] = a; });
    // Everyone sees the full roster now, so the team can coordinate — only
    // your own row (or any row, if you're admin) is actually editable.
    const rowsSource = isNew ? [] : roster;

    const modalHtml = `
      <div class="overlay" id="event-overlay">
        <div class="modal" style="max-width:720px;">
          <div class="modal-head">
            <div class="modal-title">${isNew ? 'New event' : escapeHtml(ev.name)}</div>
            <button class="modal-close" data-action="close-modal">×</button>
          </div>
          <div class="modal-body">
            <div class="section-label">Event details</div>
            <div class="field"><label>Conference / event name</label><input type="text" id="f-name" value="${escapeHtml(ev.name)}" placeholder="e.g. Global SaaS Summit 2026"></div>
            <div class="field"><label>Location</label><input type="text" id="f-location" value="${escapeHtml(ev.location)}"></div>
            <div class="field-row">
              <div class="field"><label>Start date</label><input type="date" id="f-startdate" value="${escapeHtml(ev.start_date||'')}"></div>
              <div class="field"><label>End date</label><input type="date" id="f-enddate" value="${escapeHtml(ev.end_date||'')}"></div>
            </div>
            <div class="field"><label>Website</label><input type="url" id="f-website" value="${escapeHtml(ev.website)}"></div>
            <div class="field-row">
              <div class="field"><label>Registration fee ($)</label><input type="number" id="f-regfee" value="${escapeHtml(ev.reg_fee)}"></div>
              <div class="field"><label>Vendor fee ($)</label><input type="number" id="f-vendorfee" value="${escapeHtml(ev.vendor_fee)}"></div>
            </div>

            ${isNew ? `<div style="font-size:12.5px;color:var(--ink-soft);">Save the event first, then reopen it to set staff and projects.</div>` : `
            <div class="section-label">Staff attending</div>
            ${rowsSource.map(u=>{
              const a = attendeeMap[u.id] || { attending:false, projects:[], attendeeTypes:[], meetings:[], peopleToTalk:[], sessions:[] };
              const editable = me.role === 'admin' || u.id === me.id;
              const isMe = u.id === me.id;
              return `
              <div class="staff-card">
                <div class="staff-card-head">
                  <label class="checkline"><input type="checkbox" class="f-attending" data-user="${u.id}" ${a.attending?'checked':''} ${editable?'':'disabled'}><span class="staff-card-name">${escapeHtml(u.name)}${isMe?' (you)':''}</span></label>
                  ${me.role==='admin' && u.id!==me.id ? `<button class="btn btn-ghost btn-sm" data-action="open-admin-attendance" data-event="${ev.id}" data-user="${u.id}" data-name="${escapeHtml(u.name)}">Edit their travel details</button>` : ''}
                </div>
                <div class="proj-wrap" data-proj-for="${u.id}" style="${a.attending?'':'display:none;'}">
                  <label style="margin-bottom:6px;">Attending as (select all that apply)</label>
                  <div class="chip-grid" style="margin-bottom:14px;">
                    ${ATTENDEE_TYPES.map(([val,label])=>`<div class="chip type-chip ${(a.attendeeTypes||[]).includes(val)?'selected':''} ${editable?'':'readonly'}" data-user="${u.id}" data-type="${val}">${label}</div>`).join('')}
                  </div>
                  <label style="margin-bottom:6px;">Project(s) attending under</label>
                  ${projects.length===0 ? `<div style="font-size:12.5px;color:var(--ink-soft);">No projects yet — add some under Projects.</div>` : `
                  <div class="chip-grid">
                    ${projects.map(p=>`<div class="chip proj-chip ${a.projects && a.projects.includes(p.name)?'selected':''} ${editable?'':'readonly'}" data-user="${u.id}" data-proj="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>`).join('')}
                  </div>`}
                  ${(a.meetings && a.meetings.length) || (a.peopleToTalk && a.peopleToTalk.length) || (a.sessions && a.sessions.length) ? `
                  <div class="shared-info">
                    ${a.meetings && a.meetings.length ? `
                    <div class="shared-info-label">Meetings ${isMe ? '(edit in My Travel)' : ''}</div>
                    <ul>${a.meetings.map(m=>`<li>${escapeHtml(m.text||'(untitled)')}</li>`).join('')}</ul>` : ''}
                    ${a.peopleToTalk && a.peopleToTalk.length ? `
                    <div class="shared-info-label">People to talk to ${isMe ? '(edit in My Travel)' : ''}</div>
                    <ul>${a.peopleToTalk.map(m=>`<li>${escapeHtml(m.text||'(untitled)')}</li>`).join('')}</ul>` : ''}
                    ${a.sessions && a.sessions.length ? `
                    <div class="shared-info-label">Important sessions ${isMe ? '(edit in My Travel)' : ''}</div>
                    <ul>${a.sessions.map(s=>`<li>${escapeHtml(s.title||'(untitled)')}${s.date||s.time?` — ${escapeHtml([s.date,s.time].filter(Boolean).join(' '))}`:''}${s.location?` @ ${escapeHtml(s.location)}`:''}</li>`).join('')}</ul>` : ''}
                  </div>` : ''}
                </div>
              </div>`;
            }).join('')}
            `}
          </div>
          <div class="modal-foot">
            <div>${(!isNew && me.role==='admin') ? `<button class="btn btn-danger btn-sm" data-action="delete-event" data-id="${ev.id}">Delete event</button>` : ''}</div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-ghost" data-action="close-modal">Close</button>
              <button class="btn btn-primary" data-action="save-event" data-id="${ev.id||''}" data-new="${isNew?'1':'0'}">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    window._draftAttendance = {}; // userId -> {attending, projects[], attendeeTypes[]}
    rowsSource.forEach(u=>{
      const a = attendeeMap[u.id] || { attending:false, projects:[], attendeeTypes:[] };
      window._draftAttendance[u.id] = { attending: !!a.attending, projects: (a.projects||[]).slice(), attendeeTypes: (a.attendeeTypes||[]).slice() };
    });

    document.querySelectorAll('.f-attending').forEach(cb=>{
      cb.addEventListener('change', (e)=>{
        const uid = e.target.dataset.user;
        window._draftAttendance[uid].attending = e.target.checked;
        const wrap = document.querySelector(`.proj-wrap[data-proj-for="${uid}"]`);
        if (wrap) wrap.style.display = e.target.checked ? '' : 'none';
      });
    });
    document.querySelectorAll('.type-chip:not(.readonly)').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const uid = chip.dataset.user, type = chip.dataset.type;
        const arr = window._draftAttendance[uid].attendeeTypes;
        const idx = arr.indexOf(type);
        if (idx>-1) arr.splice(idx,1); else arr.push(type);
        chip.classList.toggle('selected');
      });
    });
    document.querySelectorAll('.proj-chip:not(.readonly)').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const uid = chip.dataset.user, proj = chip.dataset.proj;
        const arr = window._draftAttendance[uid].projects;
        const idx = arr.indexOf(proj);
        if (idx>-1) arr.splice(idx,1); else arr.push(proj);
        chip.classList.toggle('selected');
      });
    });

    // Wire this modal's own buttons directly — it was inserted after the
    // last render(), so the global attachHandlers() delegation never saw it.
    document.querySelectorAll('#event-overlay [data-action="close-modal"]').forEach(el=> el.onclick = closeModal);
    const modalSaveBtn = document.querySelector('#event-overlay [data-action="save-event"]');
    if (modalSaveBtn) modalSaveBtn.onclick = ()=> saveEventFromModal(modalSaveBtn.dataset.id, modalSaveBtn.dataset.new);
    const modalDelBtn = document.querySelector('#event-overlay [data-action="delete-event"]');
    if (modalDelBtn) modalDelBtn.onclick = ()=> deleteEvent(modalDelBtn.dataset.id);
    document.querySelectorAll('#event-overlay [data-action="open-admin-attendance"]').forEach(el=>{
      el.onclick = ()=> openAdminAttendanceModal(el.dataset.event, el.dataset.user, el.dataset.name);

    });
    const modalOverlay = document.getElementById('event-overlay');
    if (modalOverlay) modalOverlay.addEventListener('click', (e)=>{ if (e.target===modalOverlay) closeModal(); });
  }

  async function saveEventFromModal(id, isNew){
    const name = document.getElementById('f-name').value.trim();
    if (!name) { showToast('Give the event a name first'); return; }
    const payload = {
      name,
      location: document.getElementById('f-location').value.trim(),
      startDate: document.getElementById('f-startdate').value,
      endDate: document.getElementById('f-enddate').value,
      website: document.getElementById('f-website').value.trim(),
      regFee: parseFloat(document.getElementById('f-regfee').value) || 0,
      vendorFee: parseFloat(document.getElementById('f-vendorfee').value) || 0,
    };
    try{
      let eventId = id;
      if (isNew === '1') {
        const created = await api('/events', { method:'POST', body: payload });
        eventId = created.id;
      } else {
        await api(`/events/${id}`, { method:'PUT', body: payload });
      }
      // push attendance changes (self always allowed; admin can push for anyone shown)
      if (window._draftAttendance) {
        for (const uid of Object.keys(window._draftAttendance)) {
          const d = window._draftAttendance[uid];
          if (String(uid) === String(me.id)) {
            await api(`/events/${eventId}/attendance/me`, { method:'PUT', body:{ attending:d.attending, attendeeTypes:d.attendeeTypes, projectNames:d.projects } });
          } else if (me.role === 'admin') {
            await api(`/admin/attendance/${eventId}/${uid}`, { method:'PUT', body:{ attending:d.attending, attendeeTypes:d.attendeeTypes, projectNames:d.projects } });
          }
        }
      }
      await loadEvents();
      closeModal();
      render();
      showToast('Event saved');
    }catch(e){ showToast(e.message); }
  }

  async function deleteEvent(id){
    if (!confirm('Delete this event? This removes all travel details entered for it too.')) return;
    try{ await api(`/events/${id}`, { method:'DELETE' }); await loadEvents(); closeModal(); render(); showToast('Event deleted'); }
    catch(e){ showToast(e.message); }
  }

  function closeModal(){
    const ov = document.getElementById('event-overlay'); if (ov) ov.remove();
    const ov2 = document.getElementById('admin-att-overlay'); if (ov2) ov2.remove();
    window._draftAttendance = null;
  }

  // ================= MY TRAVEL =================
  let myTravelData = [];
  async function renderTravelAsync(){
    myTravelData = await api('/me/travel');
    render();
  }

  function renderTravel(){
    return `
      <div class="page-head">
        <div class="eyebrow">Personal</div>
        <h1>My travel</h1>
        <div class="subtext">Accommodations, transportation, meetings, and sessions for the events you're attending.</div>
      </div>
      ${myTravelData.length===0 ? `
        <div class="empty"><b>No events yet</b>Mark yourself attending on the Events tab and it'll show up here.</div>
      ` : myTravelData.map(a => renderTravelCard(a)).join('')}
    `;
  }

  function renderTravelCard(a){
    const isOpen = !!openTravelIds[a.eventId];
    return `
      <div class="travel-card">
        <div class="travel-head" data-toggle-travel="${a.eventId}">
          <div class="travel-head-left">
            <span class="caret ${isOpen?'open':''}">▸</span>
            <div>
              <div style="font-weight:700; font-family:'Space Grotesk',sans-serif; font-size:15px;">${escapeHtml(a.eventName)}</div>
              <div style="font-size:12.5px; color:var(--ink-soft);">${escapeHtml(a.eventLocation||'')} ${a.eventDates?'· '+escapeHtml(a.eventDates):''}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <span class="status-pill ${a.registered?'status-yes':'status-no'}">${a.registered?'Registered':'Not registered'}</span>
            <span class="status-pill ${a.accommodationsBooked?'status-yes':'status-no'}">${a.accommodationsBooked?'Hotel booked':'No hotel'}</span>
            <span class="status-pill ${a.transportationBooked?'status-yes':'status-no'}">${a.transportationBooked?'Transport booked':'No transport'}</span>
          </div>
        </div>
        ${isOpen ? renderTravelBody(a, 'me') : ''}
      </div>
    `;
  }

  // Reused by both "My Travel" (scope='me') and admin per-person editor (scope='admin', needs eventId+userId baked into data-* attrs by caller)
  function renderTravelBody(a, scope){
    const evId = a.eventId;
    return `
      <div class="travel-body" data-scope="${scope}">
        <div class="section-label">Status</div>
        <div style="display:flex; gap:20px; flex-wrap:wrap; margin-bottom:6px;">
          <label class="checkline"><input type="checkbox" data-field="registered" data-event="${evId}" ${a.registered?'checked':''}><span>Registration completed</span></label>
          <label class="checkline"><input type="checkbox" data-field="accommodationsBooked" data-event="${evId}" ${a.accommodationsBooked?'checked':''}><span>Accommodations booked</span></label>
          <label class="checkline"><input type="checkbox" data-field="transportationBooked" data-event="${evId}" ${a.transportationBooked?'checked':''}><span>Transportation booked</span></label>
        </div>
        <div class="section-label">Accommodations</div>
        <div class="field-row">
          <div class="field"><label>Hotel name</label><input type="text" data-field="hotelName" data-event="${evId}" value="${escapeHtml(a.hotelName)}"></div>
          <div class="field"><label>Hotel address</label><input type="text" data-field="hotelAddress" data-event="${evId}" value="${escapeHtml(a.hotelAddress)}"></div>
        </div>
        <div class="section-label">Transportation</div>
        <div class="field"><label>Flight info (airport, flight #, times)</label><textarea data-field="flightInfo" data-event="${evId}">${escapeHtml(a.flightInfo)}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Rental car (agency, address)</label><textarea data-field="rentalCarInfo" data-event="${evId}">${escapeHtml(a.rentalCarInfo)}</textarea></div>
          <div class="field"><label>Train (departure times, stations)</label><textarea data-field="trainInfo" data-event="${evId}">${escapeHtml(a.trainInfo)}</textarea></div>
        </div>
        <div class="section-label">Meetings scheduled</div>
        <div class="list-items">
          ${a.meetings.map(m=>`<div class="list-item"><input type="text" value="${escapeHtml(m.text)}" data-list-edit="meetings" data-id="${m.id}" placeholder="Who / what / when"><button class="rm" data-list-remove="meetings" data-id="${m.id}" data-event="${evId}">×</button></div>`).join('')}
        </div>
        <button class="add-item-btn" data-list-add="meetings" data-event="${evId}">+ Add meeting</button>

        <div class="section-label">People to talk to</div>
        <div class="list-items">
          ${a.peopleToTalk.map(m=>`<div class="list-item"><input type="text" value="${escapeHtml(m.text)}" data-list-edit="people" data-id="${m.id}" placeholder="Name / company / why"><button class="rm" data-list-remove="people" data-id="${m.id}" data-event="${evId}">×</button></div>`).join('')}
        </div>
        <button class="add-item-btn" data-list-add="people" data-event="${evId}">+ Add person</button>

        <div class="section-label">Important sessions</div>
        ${a.sessions.map(s=>`
          <div class="session-row">
            <div class="field-row" style="margin-bottom:8px;">
              <div class="field" style="margin-bottom:0;"><label>Title</label><input type="text" value="${escapeHtml(s.title)}" data-session-edit="title" data-id="${s.id}"></div>
              <div class="field" style="margin-bottom:0;"><label>Location</label><input type="text" value="${escapeHtml(s.location)}" data-session-edit="location" data-id="${s.id}"></div>
            </div>
            <div class="field-row3" style="align-items:flex-end;">
              <div class="field" style="margin-bottom:0;"><label>Date</label><input type="text" value="${escapeHtml(s.date)}" data-session-edit="date" data-id="${s.id}" placeholder="Sep 16"></div>
              <div class="field" style="margin-bottom:0;"><label>Time</label><input type="text" value="${escapeHtml(s.time)}" data-session-edit="time" data-id="${s.id}" placeholder="2:00 PM"></div>
              <button class="btn btn-danger btn-sm" style="height:38px;" data-session-remove="1" data-id="${s.id}" data-event="${evId}">Remove</button>
            </div>
          </div>
        `).join('')}
        <button class="add-item-btn" data-session-add="1" data-event="${evId}">+ Add session</button>
      </div>
    `;
  }

  function fieldEndpoint(scope, evId, extra){
    if (scope === 'me') return `/me${extra}`;
    return `/admin${extra}`; // admin body already includes eventId/userId in the URL by caller
  }

  // ================= PROJECTS =================
  function renderProjects(){
    return `
      <div class="page-head">
        <div class="eyebrow">Setup</div>
        <h1>Projects</h1>
        <div class="subtext">The list staff pick from when marking which project they're attending an event under.</div>
      </div>
      <div class="roster-col" style="max-width:480px;">
        <div class="roster-title">Projects</div>
        ${projects.map(p=>`<div class="roster-item"><span>${escapeHtml(p.name)}</span>${me.role==='admin'?`<button class="rm" data-remove-project="${p.id}" style="color:var(--brick);background:none;border:none;cursor:pointer;font-size:16px;">×</button>`:''}</div>`).join('') || `<div style="font-size:13px;color:var(--ink-soft);">No projects yet.</div>`}
        ${me.role==='admin' ? `
        <div class="roster-add">
          <input type="text" id="new-project-input" placeholder="Add a project…">
          <button class="btn btn-primary btn-sm" data-action="add-project">Add</button>
        </div>` : ''}
      </div>
    `;
  }

  // ================= ADMIN =================
  function renderAdmin(){
    return `
      <div class="page-head">
        <div class="eyebrow">Admin</div>
        <h1>Admin panel</h1>
        <div class="subtext">Manage accounts, branding, and pull data for every person.</div>
      </div>
      <div class="tabs">
        <div class="tab ${adminTab==='data'?'active':''}" data-admin-tab="data">Staff data</div>
        <div class="tab ${adminTab==='users'?'active':''}" data-admin-tab="users">Users</div>
        <div class="tab ${adminTab==='branding'?'active':''}" data-admin-tab="branding">Branding</div>
      </div>
      ${adminTab==='data' ? renderAdminData() : adminTab==='users' ? renderAdminUsers() : renderAdminBranding()}
    `;
  }

  function renderAdminData(){
    return `
      <div style="margin-bottom:16px;">
        <button class="btn btn-ghost btn-sm" data-action="export-json">Export all data (JSON)</button>
        <button class="btn btn-ghost btn-sm" data-action="export-csv">Export all data (CSV)</button>
      </div>
      ${events.length===0 ? `<div class="empty"><b>No events yet</b>Add one from the Events tab first.</div>` : `
      <table class="table">
        <thead><tr><th>Event</th><th>Staff</th><th>Attending</th><th>As</th><th>Registered</th><th>Hotel</th><th>Transport</th><th></th></tr></thead>
        <tbody>
          ${events.flatMap(ev => (ev.attendees||[]).map(a => `
            <tr>
              <td>${escapeHtml(ev.name)}</td>
              <td>${escapeHtml(a.name)}</td>
              <td>${a.attending?'Yes':'No'}</td>
              <td style="text-transform:capitalize;">${(a.attendeeTypes&&a.attendeeTypes.length) ? escapeHtml(a.attendeeTypes.join(', ')) : '—'}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
              <td><button class="btn btn-ghost btn-sm" data-action="open-admin-attendance" data-event="${ev.id}" data-user="${a.userId}" data-name="${escapeHtml(a.name)}">View / edit</button></td>
            </tr>
          `)).join('') || `<tr><td colspan="8" style="color:var(--ink-soft);">No one has been marked attending yet.</td></tr>`}
        </tbody>
      </table>
      <div style="font-size:12px; color:var(--ink-soft); margin-top:8px;">Registered/hotel/transport columns load once you open a row — open "View / edit" for the live status.</div>
      `}
    `;
  }

  async function openAdminAttendanceModal(eventId, userId, name){
    let data;
    try{ data = await api(`/admin/attendance/${eventId}/${userId}`); }
    catch(e){ showToast(e.message); return; }

    const html = `
      <div class="overlay" id="admin-att-overlay">
        <div class="modal">
          <div class="modal-head">
            <div class="modal-title">${escapeHtml(name)} — ${escapeHtml(data.eventName)}</div>
            <button class="modal-close" data-action="close-admin-att">×</button>
          </div>
          <div class="modal-body" id="admin-att-body">
            ${renderTravelBody(data, 'admin')}
          </div>
          <div class="modal-foot">
            <div></div>
            <button class="btn btn-ghost" data-action="close-admin-att">Close</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('admin-att-overlay').dataset.event = eventId;
    document.getElementById('admin-att-overlay').dataset.user = userId;
    wireTravelBody(document.getElementById('admin-att-body'), 'admin', eventId, userId);
    document.querySelectorAll('[data-action="close-admin-att"]').forEach(el=> el.onclick = ()=>{
      document.getElementById('admin-att-overlay').remove();
    });
  }

  function openEditUserModal(userId){
    const u = users.find(x=>String(x.id)===String(userId));
    if (!u) { showToast('Could not find that account'); return; }

    const html = `
      <div class="overlay" id="edit-user-overlay">
        <div class="modal" style="max-width:440px;">
          <div class="modal-head">
            <div class="modal-title">Edit ${escapeHtml(u.name)}</div>
            <button class="modal-close" data-action="close-edit-user">×</button>
          </div>
          <div class="modal-body">
            <div class="field"><label>Full name</label><input type="text" id="eu-name" value="${escapeHtml(u.name)}"></div>
            <div class="field"><label>Role</label>
              <select id="eu-role">
                <option value="staff" ${u.role==='staff'?'selected':''}>Staff</option>
                <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
              </select>
            </div>
            <div class="field"><label>Reset password (optional)</label><input type="text" id="eu-password" placeholder="Leave blank to keep current password"></div>
          </div>
          <div class="modal-foot">
            <div></div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-ghost" data-action="close-edit-user">Cancel</button>
              <button class="btn btn-primary" data-action="save-edit-user" data-id="${u.id}">Save</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    const overlay = document.getElementById('edit-user-overlay');
    document.querySelectorAll('#edit-user-overlay [data-action="close-edit-user"]').forEach(el=> el.onclick = ()=> overlay.remove());
    overlay.addEventListener('click', (e)=>{ if (e.target===overlay) overlay.remove(); });
    document.querySelector('#edit-user-overlay [data-action="save-edit-user"]').onclick = async ()=>{
      const name = document.getElementById('eu-name').value.trim();
      const role = document.getElementById('eu-role').value;
      const newPassword = document.getElementById('eu-password').value;
      if (!name) { showToast('Name is required'); return; }
      if (newPassword && newPassword.length < 8) { showToast('Password must be at least 8 characters'); return; }
      try{
        await api(`/admin/users/${u.id}`, { method:'PUT', body:{ name, role, newPassword: newPassword || undefined } });
        await loadUsers();
        overlay.remove();
        render();
        showToast('Account updated');
      }catch(e){ showToast(e.message); }
    };
  }

  function renderAdminUsers(){
    return `
      <div style="max-width:720px;">
        <table class="table" style="margin-bottom:20px;">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th></th></tr></thead>
          <tbody>
            ${users.map(u=>`
              <tr>
                <td>${escapeHtml(u.name)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td><span class="role-badge ${u.role==='admin'?'role-admin':'role-staff'}">${u.role}</span></td>
                <td style="display:flex; gap:6px;">
                  <button class="btn btn-ghost btn-sm" data-action="edit-user" data-id="${u.id}">Edit</button>
                  ${u.id!==me.id ? `<button class="btn btn-danger btn-sm" data-action="delete-user" data-id="${u.id}">Delete</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="roster-col">
          <div class="roster-title">Add a staff account</div>
          <div class="field-row">
            <div class="field"><label>Full name</label><input type="text" id="new-user-name"></div>
            <div class="field"><label>Username</label><input type="text" id="new-user-username"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Temporary password</label><input type="text" id="new-user-password" placeholder="min. 8 characters"></div>
            <div class="field"><label>Role</label>
              <select id="new-user-role"><option value="staff">Staff</option><option value="admin">Admin</option></select>
            </div>
          </div>
          <button class="btn btn-primary" data-action="add-user">Create account</button>
        </div>
      </div>
    `;
  }

  function renderAdminBranding(){
    return `
      <div style="max-width:520px;">
        <div class="section-label">Logo</div>
        <div class="logo-upload-box">
          ${settings.logoPath
            ? `<img src="${settings.logoPath}" alt="Current logo">`
            : `<div class="placeholder">${(settings.companyName||'C')[0]}</div><div style="font-size:12.5px;color:var(--ink-soft); margin-bottom:10px;">No logo uploaded yet</div>`}
          <div><input type="file" id="logo-file" accept="image/png,image/jpeg,image/svg+xml,image/webp"></div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px;" data-action="upload-logo">Upload logo</button>
        </div>

        <div class="section-label">Company name</div>
        <div class="field"><input type="text" id="company-name-input" value="${escapeHtml(settings.companyName)}"></div>

        <div class="section-label">Accent color</div>
        <div class="field" style="display:flex; gap:10px; align-items:center;">
          <input type="text" id="accent-color-input" value="${escapeHtml(settings.accentColor)}" style="max-width:140px;">
          <input type="color" id="accent-color-picker" value="${settings.accentColor}">
        </div>
        <button class="btn btn-primary" data-action="save-branding">Save branding</button>
      </div>
    `;
  }

  // ================= Shared travel-body wiring =================
  function wireTravelBody(container, scope, adminEventId, adminUserId){
    container.querySelectorAll('[data-field]').forEach(el=>{
      const handler = async ()=>{
        const val = el.type==='checkbox' ? el.checked : el.value;
        try{
          if (scope==='me') {
            await api(`/me/travel/${el.dataset.event}`, { method:'PUT', body:{ [el.dataset.field]: val } });
            const idx = myTravelData.findIndex(t=>String(t.eventId)===String(el.dataset.event));
            if (idx>-1) myTravelData[idx][el.dataset.field] = val;
          } else {
            await api(`/admin/attendance/${adminEventId}/${adminUserId}`, { method:'PUT', body:{ [el.dataset.field]: val } });
          }
          if (el.type==='checkbox' && scope==='me') render();
        }catch(e){ showToast(e.message); }
      };
      el.addEventListener(el.type==='checkbox' ? 'change' : 'blur', handler);
    });

    container.querySelectorAll('[data-list-edit]').forEach(el=>{
      el.addEventListener('blur', async ()=>{
        const kind = el.dataset.listEdit; // meetings | people
        const endpoint = kind==='meetings' ? '/meetings/' : '/people/';
        try{ await api((scope==='me'?'/me':'/admin')+endpoint+el.dataset.id, { method:'PUT', body:{ text: el.value } }); }
        catch(e){ showToast(e.message); }
      });
    });
    container.querySelectorAll('[data-list-remove]').forEach(el=>{
      el.onclick = async ()=>{
        const kind = el.dataset.listRemove;
        const endpoint = kind==='meetings' ? '/meetings/' : '/people/';
        try{
          await api((scope==='me'?'/me':'/admin')+endpoint+el.dataset.id, { method:'DELETE' });
          await refreshAfterListChange(scope, el.dataset.event, adminEventId, adminUserId, container);
        }catch(e){ showToast(e.message); }
      };
    });
    container.querySelectorAll('[data-list-add]').forEach(el=>{
      el.onclick = async ()=>{
        const kind = el.dataset.listAdd;
        const endpoint = kind==='meetings' ? '/meetings' : '/people';
        try{
          if (scope==='me') await api(`/me/travel/${el.dataset.event}${endpoint}`, { method:'POST', body:{ text:'' } });
          else await api(`/admin/attendance/${adminEventId}/${adminUserId}${endpoint}`, { method:'POST', body:{ text:'' } });
          await refreshAfterListChange(scope, el.dataset.event, adminEventId, adminUserId, container);
        }catch(e){ showToast(e.message); }
      };
    });

    container.querySelectorAll('[data-session-edit]').forEach(el=>{
      el.addEventListener('blur', async ()=>{
        try{ await api((scope==='me'?'/me':'/admin')+'/sessions/'+el.dataset.id, { method:'PUT', body:{ [el.dataset.sessionEdit]: el.value } }); }
        catch(e){ showToast(e.message); }
      });
    });
    container.querySelectorAll('[data-session-remove]').forEach(el=>{
      el.onclick = async ()=>{
        try{
          await api((scope==='me'?'/me':'/admin')+'/sessions/'+el.dataset.id, { method:'DELETE' });
          await refreshAfterListChange(scope, el.dataset.event, adminEventId, adminUserId, container);
        }catch(e){ showToast(e.message); }
      };
    });
    container.querySelectorAll('[data-session-add]').forEach(el=>{
      el.onclick = async ()=>{
        try{
          if (scope==='me') await api(`/me/travel/${el.dataset.event}/sessions`, { method:'POST' });
          else await api(`/admin/attendance/${adminEventId}/${adminUserId}/sessions`, { method:'POST' });
          await refreshAfterListChange(scope, el.dataset.event, adminEventId, adminUserId, container);
        }catch(e){ showToast(e.message); }
      };
    });
  }

  async function refreshAfterListChange(scope, evId, adminEventId, adminUserId, container){
    if (scope==='me'){
      myTravelData = await api('/me/travel');
      render();
    } else {
      const u = users.find(x=>String(x.id)===String(adminUserId));
      document.getElementById('admin-att-overlay')?.remove();
      await openAdminAttendanceModal(adminEventId, adminUserId, u ? u.name : '');
    }
  }

  // ================= Event delegation =================
  function attachHandlers(){
    document.querySelectorAll('[data-nav]').forEach(el=>{
      el.onclick = async ()=>{
        view = el.dataset.nav;
        if (view==='travel') { render(); await renderTravelAsync(); return; }
        if (view==='admin' && me.role==='admin') { try{ await loadUsers(); }catch(e){} }
        render();
      };
    });
    const logoutBtn = document.querySelector('[data-action="logout"]');
    if (logoutBtn) logoutBtn.onclick = async ()=>{ await api('/auth/logout', { method:'POST' }); window.location.href='/login.html'; };

    if (view==='events'){
      const newBtn = document.querySelector('[data-action="new-event"]');
      if (newBtn) newBtn.onclick = ()=> openEventModal(null);
      document.querySelectorAll('[data-open-event]').forEach(el=>{
        el.onclick = ()=> openEventModal(el.dataset.openEvent);
      });
    }

    if (view==='travel'){
      document.querySelectorAll('[data-toggle-travel]').forEach(el=>{
        el.onclick = ()=>{ const id = el.dataset.toggleTravel; openTravelIds[id] = !openTravelIds[id]; render(); };
      });
      document.querySelectorAll('.travel-body[data-scope="me"]').forEach(body=> wireTravelBody(body, 'me'));
    }

    if (view==='projects'){
      const addBtn = document.querySelector('[data-action="add-project"]');
      if (addBtn) addBtn.onclick = async ()=>{
        const input = document.getElementById('new-project-input');
        const name = input.value.trim();
        if (!name) return;
        try{ projects = await api('/projects', { method:'POST', body:{ name } }); render(); showToast('Project added'); }
        catch(e){ showToast(e.message); }
      };
      document.querySelectorAll('[data-remove-project]').forEach(el=>{
        el.onclick = async ()=>{
          try{ projects = await api(`/projects/${el.dataset.removeProject}`, { method:'DELETE' }); render(); }
          catch(e){ showToast(e.message); }
        };
      });
    }

    if (view==='admin'){
      document.querySelectorAll('[data-admin-tab]').forEach(el=>{
        el.onclick = ()=>{ adminTab = el.dataset.adminTab; render(); };
      });
      document.querySelectorAll('[data-action="open-admin-attendance"]').forEach(el=>{
        el.onclick = ()=> openAdminAttendanceModal(el.dataset.event, el.dataset.user, el.dataset.name);
      });
      const exportJson = document.querySelector('[data-action="export-json"]');
      if (exportJson) exportJson.onclick = ()=> window.open('/api/admin/export', '_blank');
      const exportCsv = document.querySelector('[data-action="export-csv"]');
      if (exportCsv) exportCsv.onclick = ()=> window.open('/api/admin/export?format=csv', '_blank');

      if (adminTab==='users'){
        const addUser = document.querySelector('[data-action="add-user"]');
        if (addUser) addUser.onclick = async ()=>{
          const name = document.getElementById('new-user-name').value.trim();
          const username = document.getElementById('new-user-username').value.trim();
          const password = document.getElementById('new-user-password').value;
          const role = document.getElementById('new-user-role').value;
          try{
            await api('/admin/users', { method:'POST', body:{ name, username, password, role } });
            await loadUsers(); render(); showToast('Account created');
          }catch(e){ showToast(e.message); }
        };
        document.querySelectorAll('[data-action="delete-user"]').forEach(el=>{
          el.onclick = async ()=>{
            if (!confirm('Delete this account? They will no longer be able to log in.')) return;
            try{ await api(`/admin/users/${el.dataset.id}`, { method:'DELETE' }); await loadUsers(); render(); }
            catch(e){ showToast(e.message); }
          };
        });
        document.querySelectorAll('[data-action="edit-user"]').forEach(el=>{
          el.onclick = ()=> openEditUserModal(el.dataset.id);
        });
      }

      if (adminTab==='branding'){
        const saveBtn = document.querySelector('[data-action="save-branding"]');
        if (saveBtn) saveBtn.onclick = async ()=>{
          try{
            settings = await api('/admin/settings', { method:'PUT', body:{
              companyName: document.getElementById('company-name-input').value.trim(),
              accentColor: document.getElementById('accent-color-input').value.trim(),
            }});
            document.documentElement.style.setProperty('--teal', settings.accentColor);
            render(); showToast('Branding saved');
          }catch(e){ showToast(e.message); }
        };
        const picker = document.getElementById('accent-color-picker');
        if (picker) picker.oninput = ()=>{ document.getElementById('accent-color-input').value = picker.value; };
        const uploadBtn = document.querySelector('[data-action="upload-logo"]');
        if (uploadBtn) uploadBtn.onclick = async ()=>{
          const fileInput = document.getElementById('logo-file');
          if (!fileInput.files[0]) { showToast('Choose a file first'); return; }
          const fd = new FormData();
          fd.append('logo', fileInput.files[0]);
          try{
            const res = await fetch('/api/admin/logo', { method:'POST', body: fd });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            settings = data;
            render(); showToast('Logo updated');
          }catch(e){ showToast(e.message); }
        };
      }
    }
  }

  boot();
})();
