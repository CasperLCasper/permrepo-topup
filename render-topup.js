const express = require('express');
const { TurboFactory, EthereumSigner } = require('@ardrive/turbo-sdk');
const { ethers } = require('ethers');

const app = express();

const PORT = process.env.PORT || 3000;
const RPC_URL = 'https://sepolia.base.org';
const ARWEAVE_STORAGE_KEY = process.env.ARWEAVE_STORAGE_KEY;
const TOP_UP_AMOUNT = process.env.TOP_UP_AMOUNT || '0.01';

app.get('/api/topup-credits', async (req, res) => {
    try {
        if (!ARWEAVE_STORAGE_KEY) {
            return res.status(500).json({ error: 'ARWEAVE_STORAGE_KEY not configured' });
        }

        const topUpAmountEth = parseFloat(TOP_UP_AMOUNT);
        const topUpAmountWei = ethers.parseEther(topUpAmountEth.toString());

        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(ARWEAVE_STORAGE_KEY, provider);
        const address = await wallet.getAddress();

        const ethBalance = await provider.getBalance(address);
        console.log('ETH bilance:', ethers.formatEther(ethBalance), 'ETH');

        if (ethBalance < topUpAmountWei) {
            return res.status(400).json({ 
                error: 'Nepietiekami ETH.',
                address, balance: ethers.formatEther(ethBalance)
            });
        }

        const signer = new EthereumSigner(ARWEAVE_STORAGE_KEY);
        const turbo = TurboFactory.authenticated({
            signer, token: 'base-eth', gatewayUrl: RPC_URL,
            paymentServiceConfig: { url: 'https://payment.services.ar-io.dev' },
            uploadServiceConfig: { url: 'https://upload.services.ar-io.dev' }
        });

        const { winc: before } = await turbo.getBalance();
        console.log('Krediti pirms:', before.toString());

        try {
            await turbo.topUpWithTokens({ tokenAmount: topUpAmountWei });
        } catch (topUpError) {
            const txIdMatch = topUpError.message.match(/0x[a-fA-F0-9]{64}/);
            if (txIdMatch) {
                console.log('Atkartoti iesniedz transakciju:', txIdMatch[0]);
                await turbo.submitFundTransaction({ txId: txIdMatch[0] });
            } else {
                throw topUpError;
            }
        }
        
        const { winc: after } = await turbo.getBalance();
        console.log('Krediti pec:', after.toString());

        return res.json({
            success: true, address,
            topUpAmount: topUpAmountEth + ' ETH (Base Sepolia)',
            creditsAdded: (after - before).toString()
        });

    } catch (error) {
        console.error('Topup error:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Serveris klausas uz porta ${PORT}`));
