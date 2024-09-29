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
import dotenv from 'dotenv';

dotenv.config();

// 检查环境变量是否存在
const requiredEnvVars = ['PINATA_API_KEY', 'PINATA_SECRET_KEY', 'WALLET_PATH'];
requiredEnvVars.forEach((variable) => {
    if (!process.env[variable]) {
        console.error(`❌ - 缺少环境变量: ${variable}`);
        process.exit(1);
    }
});

const CLUSTERS = {
    '主网': 'https://mainnetbeta-rpc.eclipse.xyz',
    '测试网': 'https://testnet.dev2.eclipsenetwork.xyz',
};

const OPTIONS: TransactionBuilderSendAndConfirmOptions = {
    confirm: { commitment: 'processed' }
};

const NFT_DETAILS = {
    name: "名称",
    symbol: "符号",
    royalties: 500,
    description: '信息，ziqing 指南',
    imgType: 'image/jpg',
    attributes: [
        { trait_type: '准确性', value: '非常高' },
    ]
};

const PINATA_API_KEY = process.env.PINATA_API_KEY; // 使用环境变量
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY; // 使用环境变量
const umi = createUmi(CLUSTERS['测试网'], OPTIONS.confirm).use(niftyAsset());
const wallet = process.env.WALLET_PATH; // 使用环境变量

const secretKey = JSON.parse(fs.readFileSync(wallet, 'utf-8'));
const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secretKey));
umi.use(keypairIdentity(keypair));
const creator = createSignerFromKeypair(umi, keypair);
const owner = creator; // 将 NFT 铸造给创作者
const asset = generateSigner(umi);

class UploadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UploadError";
    }
}

class MintError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MintError";
    }
}

class VerificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VerificationError";
    }
}

async function uploadImage(path: string, contentType = 'image/png'): Promise<string> {
    try {
        const image = await readFile(path);
        const fileName = path.split('/').pop() ?? 'unknown.png';
        const genericImage = createGenericFile(image, fileName, { contentType });
        const cid = await uploadToIpfs(genericImage, PINATA_API_KEY, PINATA_SECRET_KEY);
        console.log(`1. ✅ - 已上传图片到 IPFS`);
        return cid;
    } catch (error) {
        console.error('1. ❌ - 上传图片时出错:', error.message);
        throw new UploadError(`上传图片失败: ${error.message}`);
    }
}

async function uploadMetadata(imageUri: string): Promise<string> {
    try {
        const gatewayUrl = 'https://gateway.pinata.cloud/ipfs';
        const fullImageUri = `${gatewayUrl}${imageUri}`;

        const metadata = {
            name: NFT_DETAILS.name,
            description: NFT_DETAILS.description,
            image: fullImageUri,
            attributes: NFT_DETAILS.attributes,
            properties: {
                files: [
                    {
                        type: NFT_DETAILS.imgType,
                        uri: fullImageUri,
                    },
                ]
            }
        };

        const file = createGenericFileFromJson(metadata, 'metadata.json');
        const cid = await uploadToIpfs(file, PINATA_API_KEY, PINATA_SECRET_KEY);
        console.log(`2. ✅ - 已上传元数据到 IPFS`);
        return cid;
    } catch (error) {
        console.error('2. ❌ - 上传元数据时出错:', error.message);
        throw new UploadError(`上传元数据失败: ${error.message}`);
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
        console.log(`3. ✅ - 铸造了新的资产: ${nftAddress}`);
    } catch (error) {
        console.error('3. ❌ - 铸造新的 NFT 时出错:', error.message);
        throw new MintError(`铸造 NFT 失败: ${error.message}`);
    }
}

async function verifyOnChainData(metadataUri: string): Promise<void> {
    try {
        const assetData = await fetchAsset(umi, asset.publicKey, OPTIONS.confirm);

        const onChainCreators = assetData.extensions.find(ext => ext.type === 3) as Creators;
        const onChainMetadata = assetData.extensions.find(ext => ext.type === 5) as Metadata;
        const onChainRoyalties = assetData.extensions.find(ext => ext.type === 7) as Royalties;

        const checks = [
            { condition: assetData.owner.toString() === owner.publicKey.toString(), message: '所有者匹配' },
            { condition: assetData.publicKey.toString() === asset.publicKey.toString(), message: '公钥匹配' },
            { condition: assetData.name === NFT_DETAILS.name, message: '资产名称匹配' },
            { condition: !!onChainCreators, message: '找不到创作者扩展' },
            { condition: onChainCreators.values.length === 1, message: '创作者长度匹配' },
            { condition: onChainCreators.values[0].address.toString() === creator.publicKey.toString(), message: '创作者地址匹配' },
            { condition: onChainCreators.values[0].share === 100, message: '创作者份额匹配' },
            { condition: onChainCreators.values[0].verified === true, message: '创作者未验证' },
            { condition: !!onChainMetadata, message: '找不到元数据扩展' },
            { condition: onChainMetadata.symbol === NFT_DETAILS.symbol, message: '符号匹配' },
            { condition: onChainMetadata.description === NFT_DETAILS.description, message: '描述匹配' },
            { condition: onChainMetadata.uri === metadataUri, message: '元数据 URI 匹配' },
            { condition: !!onChainRoyalties, message: '找不到版税扩展' },
            { condition: onChainRoyalties.basisPoints.toString() === NFT_DETAILS.royalties.toString(), message: '版税基点匹配' },
        ];

        checks.forEach(({ condition, message }) => {
            if (!condition) throw new VerificationError(`验证失败: ${message}`);
        });

        console.log(`4. ✅ - 验证资产数据成功`);
    } catch (error) {
        console.error('4. ❌ - 验证资产数据时出错:', error.message);
        throw new VerificationError(`验证资产数据失败: ${error.message}`);
    }
}

async function main() {
    try {
        const imageCid = await uploadImage('./image.jpg'); 
        console.log('图片 CID:', imageCid);
        
        const metadataCid = await uploadMetadata(imageCid); 
        console.log('元数据 CID:', metadataCid);
        
        await mintAsset(metadataCid);
        await verifyOnChainData(metadataCid);
    } catch (error) {
        console.error('主函数遇到错误:', error.message);
    }
}

main();
