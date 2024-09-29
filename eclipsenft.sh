#!/bin/bash

# 下载并执行 logo 脚本
curl -s https://raw.githubusercontent.com/ziqing888/logo.sh/main/logo.sh | bash
sleep 3

# 显示消息的函数
show() {
    echo -e "\e[32m$1\e[0m"  # 绿色的消息
}

# 创建 Eclipse 目录并进入
mkdir -p Eclipse && cd Eclipse

# 安装 Node.js、npm、Rust 和 Solana 的函数
install_all() {
    show "正在安装 Node.js 和 npm..."
    if ! source <(wget -O - https://raw.githubusercontent.com/ziqing888/installation/main/node.sh); then
        show "Node.js 和 npm 安装失败，正在退出。"
        exit 1
    fi
    show "Node.js 和 npm 安装完成。"

    show "正在安装 Rust..."
    if ! source <(wget -O - https://raw.githubusercontent.com/zunxbt/installation/main/rust.sh); then
        show "Rust 安装失败，正在退出。"
        exit 1
    fi
    show "Rust 安装完成。"

    if ! command -v solana &> /dev/null; then
        show "未找到 Solana，正在安装 Solana..."
        if ! sh -c "$(curl -sSfL https://release.solana.com/v1.18.18/install)"; then
            show "Solana 安装失败，正在退出。"
            exit 1
        fi
    else
        show "Solana 已经安装。"
    fi

    # 添加 Solana 到 PATH，如果尚未添加
    if ! grep -q "$HOME/.local/share/solana/install/active_release/bin" ~/.bashrc; then
        echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
        show "已将 Solana 添加到 .bashrc 的 PATH 中。"
    fi

    if [ -n "$ZSH_VERSION" ]; then
        if ! grep -q "$HOME/.local/share/solana/install/active_release/bin" ~/.zshrc; then
            echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc
            show "已将 Solana 添加到 .zshrc 的 PATH 中。"
        fi
    fi

    # 加载相应的配置文件
    if [ -n "$BASH_VERSION" ]; then
        source ~/.bashrc
    elif [ -n "$ZSH_VERSION" ]; then
        source ~/.zshrc
    fi

    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
    
    if command -v solana &> /dev/null; then
        show "当前会话中可以使用 Solana。"
    else
        show "无法将 Solana 添加到 PATH 中，正在退出。"
        exit 1
    fi
}

# 设置钱包的函数
setup_wallet() {
    KEYPAIR_DIR="$HOME/solana_keypairs"
    mkdir -p "$KEYPAIR_DIR"

    show "您想使用现有钱包还是创建新钱包？"
    PS3="请输入您的选择（1 或 2）："
    options=("使用现有钱包" "创建新钱包")
    select opt in "${options[@]}"; do
        case $opt in
            "使用现有钱包")
                show "正在从现有钱包恢复..."
                KEYPAIR_PATH="$KEYPAIR_DIR/eclipse-wallet.json"
                if ! solana-keygen recover -o "$KEYPAIR_PATH" --force; then
                    show "恢复现有钱包失败，正在退出。"
                    exit 1
                fi
                break
                ;;
            "创建新钱包")
                show "正在创建新钱包..."
                KEYPAIR_PATH="$KEYPAIR_DIR/eclipse-wallet.json"
                if ! solana-keygen new -o "$KEYPAIR_PATH" --force; then
                    show "创建新钱包失败，正在退出。"
                    exit 1
                fi
                break
                ;;
            *) show "无效选项，请重试。" ;;
        esac
    done

    solana config set --keypair "$KEYPAIR_PATH"
    show "钱包设置完成！"

    cp "$KEYPAIR_PATH" "$PWD"
}

create_and_install_dependencies() {
    # 如果存在，则删除现有的 package.json
    rm -f package.json

    # 创建 package.json 文件
    cat <<EOF > package.json
{
  "name": "eclipse-nft",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "echo \\"Error: no test specified\\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "@metaplex-foundation/umi": "^0.9.2",
    "@metaplex-foundation/umi-bundle-defaults": "^0.9.2",
    "@nifty-oss/asset": "^0.6.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "typescript": "^5.6.2"
  }
}
EOF

    show "package.json 文件已创建。"

    show "正在安装 npm 依赖项..."
    if ! npm install --only=development; then
        show "npm 依赖项安装失败，正在退出。"
        exit 1
    fi
    show "npm 依赖项安装完成。"
}

ts_file_Setup() {
    # 检查 index.ts 是否存在并删除
    if [ -f index.ts ]; then
        rm index.ts
    else
        echo "index.ts 不存在，跳过删除。"
    fi
    
    # 下载新的 index.ts 文件
    if ! wget -O index.ts https://raw.githubusercontent.com/zunxbt/Eclipse-NFT/main/index.ts; then
        show "下载 index.ts 文件失败，正在退出。"
        exit 1
    fi

    # 提示用户输入所需的信息
    read -p "请输入 NFT 名称： " nft_name
    read -p "请输入 NFT 符号： " nft_symbol
    read -p "请输入 NFT 描述（INFO）： " nft_info
    read -p "请输入 Pinata API 密钥： " pinata_api_key
    read -p "请输入 Pinata 秘密密钥： " pinata_secret_key

    # 提示用户选择网络类型
    echo "选择要创建 NFT 的网络："
    echo "1) 主网"
    echo "2) 测试网"
    read -p "请输入您的选择（1 为主网，2 为测试网）： " network_choice

    # 根据用户选择设置网络
    if [ "$network_choice" == "1" ]; then
        network="mainnet"
    elif [ "$network_choice" == "2" ]; then
        network="testnet"
    else
        echo "无效选择，正在退出。"
        exit 1
    fi

    # 定义要修改的文件
    file_path="./index.ts"

    # 使用 sed 将占位符替换为用户输入
    sed -i "s/NAME/$nft_name/" "$file_path"
    sed -i "s/SYMBOL/$nft_symbol/" "$file_path"
    sed -i "s/INFO/$nft_info/" "$file_path"
    sed -i "s/ZUNXBT1/$pinata_api_key/" "$file_path"
    sed -i "s/ZUNXBT2/$pinata_secret_key/" "$file_path"
    sed -i "s/ZUNXBT3/$network/" "$file_path"

    echo "NFT 详情和网络已更新在 $file_path"
    
    if [ -f upload.ts ]; then
        rm upload.ts
    else
        echo "upload.ts 不存在，跳过删除。"
    fi
    
    # 下载新的 upload.ts 文件
    if ! wget -O upload.ts https://raw.githubusercontent.com/zunxbt/Eclipse-NFT/main/upload.ts; then
        show "下载 upload.ts 文件失败，正在退出。"
        exit 1
    fi

    rm -f tsconfig.json
    npx tsc --init
}

mint() {
    show "正在铸造..."
    if ! wget https://picsum.photos/200 -O image.jpg; then
        show "下载图片失败，正在退出。"
        exit 1
    fi
    if ! npx ts-node index.ts; then
        show "铸造失败，正在退出。"
        exit 1
    fi
}

# 显示菜单的函数
show_menu() {
    echo -e "\n\e[34m===== Eclipse NFT 设置菜单 =====\e[0m"
    echo "1) 安装 Node.js、Rust 和 Solana"
    echo "2) 设置钱包"
    echo "3) 安装 npm 依赖项"
    echo "4) 设置铸造文件"
    echo "5) 开始铸造"
    echo "6) 退出"
    echo -e "===================================\n"
}

# 主循环
while true;
