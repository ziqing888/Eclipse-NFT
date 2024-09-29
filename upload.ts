// upload.ts

import {
    GenericFile,
    request,
    HttpInterface,
    HttpRequest,
    HttpResponse,
} from '@metaplex-foundation/umi';

// 定义 Pinata 上传响应接口
interface PinataUploadResponse {
    IpfsHash: string;   // IPFS 哈希值
    PinSize: number;    // 钉住的文件大小
    Timestamp: string;  // 时间戳
}

// 创建 Pinata Fetch 函数
const createPinataFetch = (): HttpInterface => ({
    send: async <ResponseData, RequestData = unknown>(request: HttpRequest<RequestData>): Promise<HttpResponse<ResponseData>> => {
        let headers = new Headers(
            Object.entries(request.headers).map(([name, value]) => [name, value] as [string, string])
        );

        // 检查是否包含 Pinata API 密钥
        if (!headers.has('pinata_api_key') || !headers.has('pinata_secret_api_key')) {
            throw new Error('缺少 Pinata API 头信息');
        }

        const isJsonRequest = headers.get('content-type')?.includes('application/json') ?? false;
        const body = isJsonRequest && request.data ? JSON.stringify(request.data) : request.data as string | undefined;

        try {
            const response = await fetch(request.url, {
                method: request.method,
                headers,
                body,
                redirect: 'follow',
                signal: request.signal as AbortSignal,
            });

            const bodyText = await response.text();
            const isJsonResponse = response.headers.get('content-type')?.includes('application/json');
            const data = isJsonResponse ? JSON.parse(bodyText) : bodyText;

            return {
                data,
                body: bodyText,
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
            };
        } catch (error) {
            console.error('获取请求失败:', error);
            throw error;
        }
    },
});

// 上传文件到 IPFS 的函数
const uploadToIpfs = async <T>(
    file: GenericFile,   // 要上传的文件
    apiKey: string,     // Pinata API 密钥
    secretKey: string   // Pinata API 密钥
): Promise<string> => {
    const http = createPinataFetch();
    const endpoint = 'https://api.pinata.cloud/pinning/pinFileToIPFS';  // Pinata 上传文件的接口
    const formData = new FormData();

    // 处理内容类型为 null 的情况
    const fileBlob = new Blob([file.buffer], { type: file.contentType || undefined });

    formData.append('file', fileBlob, file.fileName); // 将文件添加到表单数据中

    const pinataRequest = request()
        .withEndpoint('POST', endpoint)
        .withHeader('pinata_api_key', apiKey)   // 设置 API 密钥
        .withHeader('pinata_secret_api_key', secretKey)  // 设置 API 秘密密钥
        .withData(formData);  // 设置请求数据

    try {
        const response = await http.send<PinataUploadResponse, FormData>(pinataRequest);
        if (!response.ok) throw new Error(`${response.status} - 请求发送失败: ${response.statusText}`);
        return response.data.IpfsHash; // 从响应中获取 IPFS 哈希值
    } catch (error) {
        console.error('请求发送失败:', error);
        throw error;
    }
};

// 导出 uploadToIpfs 函数
export { uploadToIpfs };
