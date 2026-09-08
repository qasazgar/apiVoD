import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';

const VU_COUNT = Number(__ENV.VUS || 2);

export const options = {
  vus: VU_COUNT,
  iterations: Number(__ENV.ITERATIONS || VU_COUNT),
};

const BASE_URL = 'https://api-stage.dpsb.ir/mydot/api/v1';
const LOGIN_ENDPOINT = `${BASE_URL}/auth/login/`;
const SOCKET_URL = 'wss://api-stage.dpsb.ir/chat/socket/?EIO=4&transport=websocket';
const CONVERSATION_ID = __ENV.CONVERSATION_ID || '5a0883fe-09fa-4870-8e38-b992f6dfe197';

const COMMON_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/json',
  'origin': 'https://stage.dpsb.ir',
  'referer': 'https://stage.dpsb.ir/',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
};

const LOGIN_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
};

// Two accounts messaging each other
const USERS = [
  { identifier: __ENV.USER1_IDENTIFIER || 'modaberi5', password: __ENV.USER_PASSWORD || 'Maryam!990' },
  { identifier: __ENV.USER2_IDENTIFIER || 'modaberi6', password: __ENV.USER_PASSWORD || 'Maryam!990' },
];

const MESSAGE_COUNT = Number(__ENV.MESSAGE_COUNT || 200);
const MESSAGE_TEXT = __ENV.MESSAGE_TEXT || 'hi';
const DEBUG_SOCKET = __ENV.DEBUG_SOCKET === 'true';
const SOCKET_TIMEOUT_MS = Number(__ENV.SOCKET_TIMEOUT_MS || 120000);
const LOGIN_TO_MESSAGE_DELAY_MS = Number(__ENV.LOGIN_TO_MESSAGE_DELAY_MS || 100);
const MESSAGE_INTERVAL_MS = Number(__ENV.MESSAGE_INTERVAL_MS || 1000);

function login(user, userNumber) {
  const configuredToken = __ENV[`USER${userNumber}_ACCESS_TOKEN`] || __ENV.ACCESS_TOKEN;
  if (configuredToken) {
    console.log(`Using configured access token for user ${userNumber}`);
    return configuredToken;
  }

  if (!user.identifier) {
    console.error(`Missing identifier. Set USER${userNumber}_IDENTIFIER before running the test.`);
    return null;
  }

  const res = http.post(
    LOGIN_ENDPOINT,
    JSON.stringify({ identifier: user.identifier, password: user.password }),
    { headers: LOGIN_HEADERS }
  );

  const ok = check(res, {
    'login succeeded': (r) => r.status === 200,
  });

  if (!ok) {
    console.error(`Login failed for ${user.identifier}: ${res.status} ${res.body}`);
    return null;
  }

  let body;
  try {
    body = JSON.parse(res.body);
  } catch (error) {
    const contentType = res.headers['Content-Type'] || res.headers['content-type'] || 'unknown';
    console.error(
      `Login returned non-JSON for ${user.identifier}: ` +
        `status=${res.status}, content-type=${contentType}, body=${res.body.slice(0, 500)}`
    );
    return null;
  }

  const data = body.data || {};
  const token =
    body.access ||
    body.token ||
    body.accessToken ||
    body.access_token ||
    data.access ||
    data.token ||
    data.accessToken ||
    data.access_token ||
    res.cookies.access_token?.[0]?.value;

  console.log(`Login response fields for ${user.identifier}: root=[${Object.keys(body).join(',')}]`);

  if (!token && body.pending_login_id) {
    console.error(
      `Login requires OTP for ${user.identifier}. ` +
        `Complete the OTP flow or provide USER${userNumber}_ACCESS_TOKEN.`
    );
  }
  if (!token) {
    console.error(`No access token returned for ${user.identifier}; response cookies=[${Object.keys(res.cookies).join(',')}]`);
  }
  return token;
}

export default () => {
  const vu = __VU;
  const userNumber = ((vu - 1) % USERS.length) + 1;
  const user = USERS[userNumber - 1];

  const token = login(user, userNumber);
  if (!token) {
    console.error(`VU ${vu}: no token, aborting`);
    return;
  }

  sleep(LOGIN_TO_MESSAGE_DELAY_MS / 1000);

  let sent = 0;
  let acknowledged = 0;
  let received = 0;
  let socketReady = false;
  let messagesStarted = false;
  let conversationFocused = false;
  let throttleRetryAfter = null;

  const result = ws.connect(
    SOCKET_URL,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `access_token=${token}; is_logged_in=true`,
        Origin: 'https://stage.dpsb.ir',
      },
    },
    (socket) => {
      socket.on('message', (raw) => {
        if (DEBUG_SOCKET) {
          console.log(`VU ${vu} socket frame: ${raw}`);
        }
        if (raw.startsWith('0')) {
          socket.send('40/messaging,');
          return;
        }

        if (raw.startsWith('40') && !socketReady) {
          socketReady = true;
          socket.send(
            `42/messaging,1${JSON.stringify([
              'conversation.focus',
              { conversation_id: CONVERSATION_ID },
            ])}`
          );
          return;
        }

        if (raw.startsWith('43')) {
          const payloadStart = raw.indexOf('[');
          if (payloadStart === -1) {
            console.error(`VU ${vu}: invalid Socket.IO acknowledgement: ${raw}`);
            return;
          }

          let acknowledgement;
          try {
            acknowledgement = JSON.parse(raw.slice(payloadStart));
          } catch (error) {
            console.error(`VU ${vu}: invalid acknowledgement payload: ${raw}`);
            return;
          }

          const packetStart = raw.indexOf('[');
          const packetHeader = raw.slice(2, packetStart);
          const ackId = packetHeader.slice(packetHeader.lastIndexOf(',') + 1);

          if (ackId === '1') {
            if (acknowledgement[0]?.success === false || acknowledgement[0]?.error) {
              console.error(`VU ${vu}: conversation focus failed: ${JSON.stringify(acknowledgement[0])}`);
              socket.close();
            } else {
              conversationFocused = true;
              messagesStarted = true;
              for (let index = 1; index <= MESSAGE_COUNT; index += 1) {
                if (index > 1) {
                  sleep(MESSAGE_INTERVAL_MS / 1000);
                }
                const messageAckId = `${vu}${index + 1}`;
                socket.send(
                  `42/messaging,${messageAckId}${JSON.stringify([
                    'message.send',
                    {
                      conversation_id: CONVERSATION_ID,
                      type: 'text',
                      text: MESSAGE_TEXT,
                      client_message_id:
                        `00000000-0000-4000-8000-${String(vu).padStart(4, '0')}${String(index).padStart(8, '0')}`,
                    },
                  ])}`
                );
                sent += 1;
              }
              if (MESSAGE_COUNT === 0) {
                socket.close();
              }
            }
            return;
          }

          if (acknowledgement[0]?.success === false || acknowledgement[0]?.error) {
            console.error(`VU ${vu}: message rejected: ${JSON.stringify(acknowledgement[0])}`);
          } else {
            acknowledged += 1;
          }
          if (messagesStarted && acknowledged >= MESSAGE_COUNT && received >= MESSAGE_COUNT) {
            socket.close();
          }
          return;
        }

        if (raw.startsWith('44')) {
          console.error(`VU ${vu}: Socket.IO error: ${raw}`);
          return;
        }

        if (raw.startsWith('42')) {
          let packet;
          try {
            packet = JSON.parse(raw.slice(raw.indexOf('[')));
          } catch (error) {
            console.error(`VU ${vu}: invalid Socket.IO event: ${raw}`);
            return;
          }

          if (packet[0] === 'message.new' && packet[1]?.conversation_id === CONVERSATION_ID) {
            received += 1;
            if (acknowledged >= MESSAGE_COUNT && received >= MESSAGE_COUNT) {
              socket.close();
            }
          }

          if (packet[0] === 'error') {
            console.error(`VU ${vu}: message rejected: ${JSON.stringify(packet[1])}`);
          }

          if (packet[0] === 'throttle.error') {
            throttleRetryAfter = packet[1]?.retryAfter ?? 'unknown';
            console.error(
              `VU ${vu}: chat rate limit reached; retryAfter=${throttleRetryAfter}`
            );
            socket.close();
          }

        }
      });

      socket.setTimeout(() => socket.close(), SOCKET_TIMEOUT_MS);
    }
  );

  if (!result || result.status !== 101) {
    console.error(
      `VU ${vu}: Socket.IO connection failed: ` +
        `status=${result?.status || 'unknown'}, error=${result?.error || 'unknown'}, ` +
        `error_code=${result?.error_code || 'unknown'}`
    );
  }
  check(result, { 'Socket.IO connection succeeded': (r) => r && r.status === 101 });
  check({ sent, received }, {
    'conversation focused': () => conversationFocused,
    'chat throttle not reached': () => throttleRetryAfter === null,
    [`${MESSAGE_COUNT} messages acknowledged`]: () => acknowledged >= MESSAGE_COUNT,
    [`${MESSAGE_COUNT} messages received`]: (r) => r.received >= MESSAGE_COUNT,
  });
  console.log(`VU ${vu}: emitted=${sent}, acknowledged=${acknowledged}, received=${received}`);
  sleep(1);
};