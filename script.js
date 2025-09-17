// WARNUNG: Dies ist ein vereinfachtes Beispiel. Der öffentliche Signaling-Server kann unzuverlässig sein.
// Für ein echtes Projekt solltest du einen eigenen oder bezahlten Dienst verwenden.
const SIGNALING_SERVER_URL = 'wss://your-public-signaling-server.com'; // **Ersetze dies durch eine gültige URL**
const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
    ]
};

const myIdSpan = document.getElementById('my-id');
const groupNameInput = document.getElementById('group-name-input');
const memberIdsInput = document.getElementById('member-ids-input');
const createGroupBtn = document.getElementById('create-group-btn');
const groupsList = document.getElementById('groups-list');
const chatWindow = document.getElementById('chat-window');
const currentGroupName = document.getElementById('current-group-name');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

let myId;
let ws;
let currentGroupId;
let groups = {};

// Ein Objekt, um die PeerConnections und DataChannels für jede Gruppe zu speichern
const groupConnections = {};

const MESSAGE_EXPIRY_TIME = 7 * 24 * 60 * 60 * 1000; // 7 Tage

// Hilfsfunktionen für localStorage
function getMyId() {
    let id = localStorage.getItem('messengerId');
    if (!id) {
        id = 'user-' + Math.random().toString(36).substr(2, 8);
        localStorage.setItem('messengerId', id);
    }
    myId = id;
    myIdSpan.textContent = myId;
}

function loadGroups() {
    const loadedGroups = JSON.parse(localStorage.getItem('groups')) || {};
    groups = loadedGroups;
    renderGroups();
}

function saveGroups() {
    localStorage.setItem('groups', JSON.stringify(groups));
}

function loadMessages(groupId) {
    const chat = groups[groupId];
    if (chat) {
        const now = Date.now();
        chat.messages = chat.messages.filter(msg => (now - msg.timestamp) < MESSAGE_EXPIRY_TIME);
        saveGroups();
        return chat.messages;
    }
    return [];
}

// UI-Funktionen
function renderGroups() {
    groupsList.innerHTML = '<h2>Deine Gruppen</h2>';
    for (const id in groups) {
        const group = groups[id];
        const groupItem = document.createElement('div');
        groupItem.classList.add('group-item');
        groupItem.textContent = group.name;
        groupItem.onclick = () => openChat(id);
        groupsList.appendChild(groupItem);
    }
}

function openChat(groupId) {
    currentGroupId = groupId;
    const group = groups[currentGroupId];
    currentGroupName.textContent = `Gruppe: ${group.name}`;
    chatWindow.style.display = 'block';
    renderMessages();
}

function renderMessages() {
    messagesDiv.innerHTML = '';
    const messages = loadMessages(currentGroupId);
    messages.forEach(msg => {
        const p = document.createElement('p');
        const sender = msg.sender === myId ? 'Du' : msg.sender;
        p.textContent = `${sender}: ${msg.text}`;
        messagesDiv.appendChild(p);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// WebSocket-Verbindung
function connectToSignalingServer() {
    ws = new WebSocket(SIGNALING_SERVER_URL);

    ws.onopen = () => {
        console.log('Verbunden mit dem Signaling-Server.');
        ws.send(JSON.stringify({ type: 'register', id: myId }));
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'offer') {
            await handleOffer(message);
        } else if (message.type === 'answer') {
            await handleAnswer(message);
        } else if (message.type === 'ice-candidate') {
            await handleIceCandidate(message);
        } else if (message.type === 'group-update') {
            // Wenn ein Mitglied die Gruppe verlässt oder beitritt
            console.log('Gruppen-Update erhalten:', message.groupId);
        }
    };
}

async function handleOffer(message) {
    const { offer, senderId, groupId } = message;
    
    if (!groupConnections[groupId]) {
        setupGroupConnection(groupId);
    }

    const conn = groupConnections[groupId].peerConnections[senderId];
    if (!conn) return;

    await conn.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', targetId: senderId, answer: conn.localDescription, groupId }));
}

async function handleAnswer(message) {
    const { answer, senderId, groupId } = message;
    const conn = groupConnections[groupId].peerConnections[senderId];
    if (conn) {
        await conn.setRemoteDescription(new RTCSessionDescription(answer));
    }
}

async function handleIceCandidate(message) {
    const { candidate, senderId, groupId } = message;
    const conn = groupConnections[groupId].peerConnections[senderId];
    if (conn) {
        await conn.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

// Gruppen-Funktionalität
function setupGroupConnection(groupId) {
    groupConnections[groupId] = {
        peerConnections: {},
        dataChannels: {},
    };

    const group = groups[groupId];
    const members = group.members.filter(id => id !== myId);

    members.forEach(memberId => {
        const conn = new RTCPeerConnection(ICE_SERVERS);
        
        conn.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ type: 'ice-candidate', targetId: memberId, candidate: event.candidate, groupId }));
            }
        };

        const dataChannel = conn.createDataChannel('chat');
        dataChannel.onmessage = (event) => {
            const receivedMessage = JSON.parse(event.data);
            if (receivedMessage.groupId === groupId) {
                const messageObj = { sender: receivedMessage.sender, text: receivedMessage.text, timestamp: Date.now() };
                groups[groupId].messages.push(messageObj);
                saveGroups();
                if (currentGroupId === groupId) {
                    renderMessages();
                }
            }
        };

        groupConnections[groupId].peerConnections[memberId] = conn;
        groupConnections[groupId].dataChannels[memberId] = dataChannel;
    });
}

createGroupBtn.onclick = () => {
    const groupName = groupNameInput.value.trim();
    const memberIds = memberIdsInput.value.split(',').map(id => id.trim()).filter(id => id);

    if (!groupName || memberIds.length === 0) {
        alert('Bitte gib einen Gruppennamen und mindestens eine Mitglieder-ID ein.');
        return;
    }

    const allMembers = [...memberIds, myId];
    const newGroupId = `group-${Date.now()}`;
    
    groups[newGroupId] = {
        id: newGroupId,
        name: groupName,
        members: allMembers,
        messages: [],
    };
    saveGroups();
    renderGroups();
    
    // Peer-Verbindungen für die neue Gruppe aufbauen
    setupGroupConnection(newGroupId);
    
    // Offers an alle anderen Mitglieder senden
    allMembers.forEach(memberId => {
        if (memberId !== myId) {
            const conn = groupConnections[newGroupId].peerConnections[memberId];
            if (conn) {
                conn.createOffer().then(offer => {
                    conn.setLocalDescription(offer);
                    ws.send(JSON.stringify({ type: 'offer', targetId: memberId, offer: conn.localDescription, senderId: myId, groupId: newGroupId }));
                });
            }
        }
    });
    
    groupNameInput.value = '';
    memberIdsInput.value = '';
};

sendBtn.onclick = () => {
    const messageText = messageInput.value;
    if (!messageText.trim() || !currentGroupId) return;

    const group = groups[currentGroupId];
    const messageObj = { sender: myId, text: messageText, timestamp: Date.now() };
    group.messages.push(messageObj);
    saveGroups();
    renderMessages();
    
    // Nachricht an alle Gruppenmitglieder senden
    const groupDataChannels = groupConnections[currentGroupId].dataChannels;
    for (const memberId in groupDataChannels) {
        if (groupDataChannels[memberId].readyState === 'open') {
            const data = JSON.stringify({ type: 'chat-message', sender: myId, text: messageText, groupId: currentGroupId });
            groupDataChannels[memberId].send(data);
        }
    }
    messageInput.value = '';
};


// Anwendung starten
getMyId();
connectToSignalingServer();
loadGroups();
