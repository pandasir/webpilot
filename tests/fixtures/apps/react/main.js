import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
function App(){
 const [message,setMessage]=useState(''),[query,setQuery]=useState('');
 return React.createElement('main',{},
 React.createElement('h1',{},'Framework fixture'),
 React.createElement('form',{onSubmit:e=>{e.preventDefault();setMessage('Invalid password');}},
 React.createElement('label',{},'Email',React.createElement('input',{name:'email',type:'email'})),
 React.createElement('label',{},'Password',React.createElement('input',{name:'password',type:'password'})),
 React.createElement('button',{},'Log in'),React.createElement('p',{role:'alert'},message)),
 React.createElement('label',{},'Search',React.createElement('input',{value:query,onChange:e=>setQuery(e.target.value)})),
 React.createElement('ul',{},...['Apple','Orange'].filter(x=>x.toLowerCase().includes(query.toLowerCase())).map(x=>React.createElement('li',{key:x},x))));
}
createRoot(document.querySelector('#root')).render(React.createElement(App));
