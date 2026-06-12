import"./modulepreload-polyfill-B5Qt9EMX.js";import{c as E,j as e,r as i}from"./client-B-OClMmu.js";import{D as K,P as l}from"./providers-B-uW_wjG.js";const v={anthropic:"Claude",openai:"OpenAI",google:"Gemini",groq:"Groq",mistral:"Mistral",ollama:"Ollama"};function z(s){const r=s.trim();return r.length<8?null:r.startsWith("sk-ant-")?"anthropic":r.startsWith("AIza")?"google":r.startsWith("gsk_")?"groq":r.startsWith("sk-")&&!r.startsWith("sk-ant")?"openai":null}const C=`
  :root { color-scheme: dark; }
  .ta-root {
    width: 340px;
    background: linear-gradient(180deg, #161616 0%, #0f0f0f 72px);
    color: #f1f1f1;
    font-family: 'Roboto', 'Arial', sans-serif;
    font-size: 13px;
    padding: 16px;
    box-sizing: border-box;
  }
  .ta-header { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; }
  .ta-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff0000; flex-shrink: 0; }
  .ta-wordmark { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
  .ta-save-state {
    margin-left: auto; font-size: 11px; color: #2ba640;
    opacity: 0; transition: opacity 0.25s; display: flex; align-items: center; gap: 4px;
  }
  .ta-save-state.visible { opacity: 1; }

  .ta-label {
    font-size: 11px; font-weight: 600; color: #aaa;
    text-transform: uppercase; letter-spacing: 0.06em;
    margin: 0 0 8px;
  }

  .ta-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .ta-chip {
    position: relative;
    border: none; cursor: pointer;
    background: rgba(255,255,255,0.08);
    color: #f1f1f1;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px; font-weight: 500;
    font-family: inherit;
    transition: background 0.15s, color 0.15s;
  }
  .ta-chip:hover { background: rgba(255,255,255,0.16); }
  .ta-chip.active { background: #f1f1f1; color: #0f0f0f; font-weight: 600; }
  .ta-chip .key-dot {
    display: inline-block; width: 5px; height: 5px; border-radius: 50%;
    background: #2ba640; margin-left: 6px; vertical-align: 1px;
  }
  .ta-chip.active .key-dot { background: #1a7a2e; }

  .ta-field { position: relative; margin-bottom: 6px; }
  .ta-input {
    width: 100%; box-sizing: border-box;
    background: #212121;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 10px 38px 10px 12px;
    color: #f1f1f1;
    font-size: 12.5px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    outline: none;
    transition: border-color 0.15s;
  }
  .ta-input::placeholder { font-family: 'Roboto', 'Arial', sans-serif; color: #717171; }
  .ta-input:focus { border-color: rgba(255,255,255,0.35); }
  .ta-eye {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; padding: 4px;
    color: #aaa; display: flex; align-items: center;
    border-radius: 6px;
  }
  .ta-eye:hover { color: #f1f1f1; background: rgba(255,255,255,0.08); }

  .ta-hint { font-size: 11px; color: #717171; margin: 0 0 16px; min-height: 14px; }
  .ta-detected {
    display: inline-flex; align-items: center; gap: 4px;
    color: #2ba640; font-weight: 600;
    animation: ta-pop 0.2s ease-out;
  }
  @keyframes ta-pop {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ta-select-wrap { position: relative; margin-bottom: 18px; }
  .ta-select {
    width: 100%; box-sizing: border-box; appearance: none;
    background: #212121;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 10px 32px 10px 12px;
    color: #f1f1f1; font-size: 13px; font-family: inherit;
    cursor: pointer; outline: none;
    transition: border-color 0.15s;
  }
  .ta-select:focus { border-color: rgba(255,255,255,0.35); }
  .ta-select-wrap::after {
    content: ""; position: absolute; right: 13px; top: 50%;
    width: 7px; height: 7px; pointer-events: none;
    border-right: 1.5px solid #aaa; border-bottom: 1.5px solid #aaa;
    transform: translateY(-70%) rotate(45deg);
  }

  .ta-toggle-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 12px; border-radius: 10px;
    background: rgba(255,255,255,0.04);
    cursor: pointer;
  }
  .ta-switch {
    position: relative; width: 34px; height: 20px; flex-shrink: 0;
    border-radius: 10px; background: rgba(255,255,255,0.2);
    transition: background 0.2s; margin-top: 1px;
  }
  .ta-switch.on { background: #ff0000; }
  .ta-switch::after {
    content: ""; position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%; background: #fff;
    transition: transform 0.2s;
  }
  .ta-switch.on::after { transform: translateX(14px); }
  .ta-toggle-title { font-size: 13px; }
  .ta-toggle-sub { font-size: 11px; color: #717171; margin-top: 2px; }
`;function T(){const[s,r]=i.useState(K),[f,k]=i.useState(!1),[j,h]=i.useState("idle"),[d,g]=i.useState(!1),[c,u]=i.useState(null),p=i.useRef({}),x=i.useRef();i.useEffect(()=>{chrome.runtime.sendMessage({type:"GET_SETTINGS"},t=>{if(t){const a=t;if(a.selectedModel===""&&a.apiKeys){const o=l.find(n=>(a.apiKeys[n.id]??"").trim());o&&(a.selectedProvider=o.id,a.selectedModel=o.models[0].id)}p.current={...a.apiKeys},r(a)}k(!0)})},[]),i.useEffect(()=>{if(f)return clearTimeout(x.current),x.current=setTimeout(()=>{chrome.runtime.sendMessage({type:"SAVE_SETTINGS",payload:s},()=>{p.current={...s.apiKeys},h("saved"),setTimeout(()=>h("idle"),1600)})},450),()=>clearTimeout(x.current)},[s,f]);const m=l.find(t=>t.id===s.selectedProvider),w=s.selectedProvider==="ollama";function S(t){u(null),g(!1);const a=l.find(o=>o.id===t);r(o=>({...o,selectedProvider:t,selectedModel:a.models.some(n=>n.id===o.selectedModel)?o.selectedModel:a.models[0].id}))}function N(t){const a=z(t);u(a),r(o=>{const n=o.selectedProvider;if(a&&a!==n){const y={...o.apiKeys,[a]:t};y[n]=p.current[n]??"";const M=l.find(P=>P.id===a);return{...o,apiKeys:y,selectedProvider:a,selectedModel:M.models[0].id}}return{...o,apiKeys:{...o.apiKeys,[n]:t}}})}const b=s.apiKeys[s.selectedProvider]??"";return e.jsxs("div",{className:"ta-root",children:[e.jsx("style",{children:C}),e.jsxs("div",{className:"ta-header",children:[e.jsx("div",{className:"ta-dot"}),e.jsx("span",{className:"ta-wordmark",children:"TranscriptAI"}),e.jsx("span",{className:`ta-save-state ${j==="saved"?"visible":""}`,children:"✓ Saved"})]}),e.jsx("p",{className:"ta-label",children:"Provider"}),e.jsx("div",{className:"ta-chips",children:l.map(t=>e.jsxs("button",{type:"button",className:`ta-chip ${t.id===s.selectedProvider?"active":""}`,onClick:()=>S(t.id),children:[v[t.id],t.requiresKey&&(s.apiKeys[t.id]??"").trim()&&e.jsx("span",{className:"key-dot"})]},t.id))}),w?e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"ta-field",children:e.jsx("input",{className:"ta-input",type:"text",value:s.ollamaBaseUrl,onChange:t=>r(a=>({...a,ollamaBaseUrl:t.target.value})),placeholder:"http://localhost:11434"})}),e.jsx("p",{className:"ta-hint",children:"Runs locally — no API key needed."})]}):e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"ta-field",children:[e.jsx("input",{className:"ta-input",type:d?"text":"password",value:b,onChange:t=>N(t.target.value),placeholder:"Paste any API key — provider auto-detects",spellCheck:!1,autoComplete:"off"}),e.jsx("button",{type:"button",className:"ta-eye",onClick:()=>g(t=>!t),title:d?"Hide key":"Show key",children:e.jsx("svg",{width:"15",height:"15",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d?e.jsxs(e.Fragment,{children:[e.jsx("path",{d:"M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"}),e.jsx("path",{d:"M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"}),e.jsx("line",{x1:"1",y1:"1",x2:"23",y2:"23"})]}):e.jsxs(e.Fragment,{children:[e.jsx("path",{d:"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"}),e.jsx("circle",{cx:"12",cy:"12",r:"3"})]})})})]}),e.jsx("p",{className:"ta-hint",children:c?e.jsxs("span",{className:"ta-detected",children:["✓ ",v[c]," key detected"]},c):b?`Used for ${m.label}`:"Stored locally, never leaves your browser."})]}),e.jsx("p",{className:"ta-label",children:"Model"}),e.jsx("div",{className:"ta-select-wrap",children:e.jsxs("select",{className:"ta-select",value:s.selectedModel,onChange:t=>r(a=>({...a,selectedModel:t.target.value})),children:[s.selectedModel===""&&e.jsx("option",{value:"",disabled:!0,children:"Choose a model…"}),m.models.map(t=>e.jsx("option",{value:t.id,children:t.label},t.id))]})}),e.jsxs("div",{className:"ta-toggle-row",onClick:()=>r(t=>({...t,semanticSearchEnabled:!t.semanticSearchEnabled})),children:[e.jsx("div",{className:`ta-switch ${s.semanticSearchEnabled?"on":""}`}),e.jsxs("div",{children:[e.jsx("div",{className:"ta-toggle-title",children:"Semantic search"}),e.jsx("div",{className:"ta-toggle-sub",children:"Meaning-based transcript search. Downloads a 23 MB model once."})]})]})]})}E(document.getElementById("root")).render(e.jsx(T,{}));
