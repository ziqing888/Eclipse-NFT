import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
    TransactionBuilderSendAndConfirmOptions,
    createGenericFile,
    createGenericFileFromJson,
    createSignerFromKeypair,
    generateSigner,
    keypairIdentity,
} from '@metaplex-foundation/umi';
import {
    metadata,
    mint,
    niftyAsset,
    fetchAsset,
    Metadata,
    royalties,
    creators,
    Royalties,
    Creators,
} from '@nifty-oss/asset';
import { readFile } from "fs/promises";
import { uploadToIpfs } from './upload';
import fs from 'fs';

const CLUSTERS = {
    'mainnet': 'https://mainnetbeta-rpc.eclipse.xyz',
    'testnet': 'https://testnet.dev2.eclipsenetwork.xyz',
};

const OPTIONS: TransactionBuilderSendAndConfirmOptions = {
    confirm: { commitment: 'processed' }
};

// NFT 详细信息
const NFT_DETAILS = {
    name: "名称",
    symbol: "符号",
    royalties: 500,
    description: '信息，由 ZunXBT 指导',
    imgType: 'image/jpg',
    attributes: [
        { trait_type: '准确性', value: '非常高' },
    ]
};

const PINATA_API_KEY = 'ZUNXBT1'; // 👈 替换为你的 Pinata API 密钥
const PINATA_SECRET_KEY = 'ZUNXBT2'; // 👈 替换为你的 IPFS API 密钥
const umi = createUmi(CLUSTERS.testnet, OPTIONS.confirm).use(niftyAsset()); // 👈 替换为你的集群
const wallet = './eclipse-wallet.json'; // 👈 替换为你的钱包路径 

const secretKey = JSON.parse(fs.readFileSync(wallet, 'utf-8'));
const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secretKey));
umi.use(keypairIdentity(keypair));
const creator = createSignerFromKeypair(umi, keypair);
const owner = creator; // 铸造给创建者
const asset = generateSigner(umi);

async function uploadImage(path: string, contentType = 'image/png'): Promise<string> {
    try {
        const image = await readFile(path);
        const fileName = path.split('/').pop() ?? 'unknown.png';
        const genericImage = createGenericFile(image, fileName, { contentType });
        const cid = await uploadToIpfs(genericImage, PINATA_API_KEY, PINATA_SECRET_KEY);
        console.log(`1. ✅ - 图像已上传到 IPFS`);
        return cid;
    } catch (error) {
        console.error('1. ❌ - 上传图像时出错:', error);
        throw error;
    }
}

async function uploadMetadata(imageUri: string): Promise<string> {
    try {
        const gatewayUrl = 'https://gateway.pinata.cloud/ipfs'; // 添加 IPFS 网关 URL
        const fullImageUri = `${gatewayUrl}${imageUri}`; // 图像的完整 URI

        const metadata = {
            name: NFT_DETAILS.name,
            description: NFT_DETAILS.description,
            image: fullImageUri, // 使用完整的图像 URI
            attributes: NFT_DETAILS.attributes,
            properties: {
                files: [
                    {
                        type: NFT_DETAILS.imgType,
                        uri: fullImageUri, // 使用完整的图像 URI
                    },
                ]
            }
        };

        const file = createGenericFileFromJson(metadata, 'metadata.json');
        const cid = await uploadToIpfs(file, PINATA_API_KEY, PINATA_SECRET_KEY);
        console.log(`2. ✅ - 元数据已上传到 IPFS`);
        return cid;
    } catch (error) {
        console.error('2. ❌ - 上传元数据时出错:', error);
        throw error;
    }
}

async function mintAsset(metadataUri: string): Promise<void> {
    try {
        await mint(umi, {
            asset,
            owner: owner.publicKey,
            authority: creator.publicKey,
            payer: umi.identity,
            mutable: false,
            standard: 0,
            name: NFT_DETAILS.name,
            extensions: [
                metadata({
                    uri: metadataUri,
                    symbol: NFT_DETAILS.symbol,
                    description: NFT_DETAILS.description,
                }),
                royalties(NFT_DETAILS.royalties),
                creators([{ address: creator.publicKey, share: 100 }]),
            ]
        }).sendAndConfirm(umi, OPTIONS);
        const nftAddress = asset.publicKey.toString();
        console.log(`3. ✅ - 已铸造新资产: ${nftAddress}`);
    } catch (error) {
        console.error('3. ❌ - 铸造新 NFT 时出错。', error);
    }
}

async function verifyOnChainData(metadataUri: string): Promise<void> {
    try {
        const assetData = await fetchAsset(umi, asset.publicKey, OPTIONS.confirm);

        const onChainCreators = assetData.extensions.find(ext => ext.type === 3) as Creators;
        const onChainMetadata = assetData.extensions.find(ext => ext.type === 5) as Metadata;
        const onChainRoyalties = assetData.extensions.find(ext => ext.type === 7) as Royalties;

        const checks = [
            // 资产检查
            { condition: assetData.owner.toString() === owner.publicKey.toString(), message: '所有者匹配' },
            { condition: assetData.publicKey.toString() === asset.publicKey.toString(), message: '公钥匹配' },
            { condition: assetData.name === NFT_DETAILS.name, message: '资产名称匹配' },

            // 创建者扩展检查
            { condition: !!onChainCreators, message: '未找到创建者扩展' },
            { condition: onChainCreators.values.length === 1, message: '创建者长度匹配' },
            { condition: onChainCreators.values[0].address.toString() === creator.publicKey.toString(), message: '创建者地址匹配' },
            { condition: onChainCreators.values[0].share === 100, message: '创建者份额匹配' },
            { condition: onChainCreators.values[0].verified === true, message: '创建者未验证' },

            // 元数据扩展检查
            { condition: !!onChainMetadata, message: '未找到元数据扩展' },
            { condition: onChainMetadata.symbol === NFT_DETAILS.symbol, message: '符号匹配' },
            { condition: onChainMetadata.description === NFT_DETAILS.description, message: '描述匹配' },
            { condition: onChainMetadata.uri === metadataUri, message: '元数据 URI 匹配' },

            // 版税扩展检查
            { condition: !!onChainRoyalties, message: '未找到版税扩展' },
            { condition: onChainRoyalties.basisPoints.toString() === NFT_DETAILS.royalties.toString(), message: '版税基点匹配' },
        ];

        checks.forEach(({ condition, message }) => {
            if (!condition) throw new Error(`验证失败: ${message}`);
        });

        console.log(`4. ✅ - 验证资产数据成功`);
    } catch (error) {
        console.error('4. ❌ - 验证资产数据时出错:', error);
    }
}

async function main() {
    const imageCid = await uploadImage('./image.jpg'); 
    console.log('图像 CID:', imageCid); // 日志记录图像 CID
    const metadataCid = await uploadMetadata(imageCid); 
    console.log('元数据 CID:', metadataCid); // 日志记录元数据 CID
    await mintAsset(metadataCid);
    await verifyOnChainData(metadataCid);
}

main();
