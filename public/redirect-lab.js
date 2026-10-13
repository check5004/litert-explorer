const tab=document.body.dataset.lab;
if(tab==='decision'||tab==='generation')location.replace(new URL('../#'+tab,location.href).href);
