import { Connection, PublicKey, Keypair } from '@solana/web3.js';

import {
  TribecaSDK,
  findGovernorAddress,
  GovernorWrapper,
} from '@tribecahq/tribeca-sdk';
import {} from '@tribecahq/registry';
import { Provider } from '@project-serum/anchor';
import { SolanaProvider } from '@saberhq/solana-contrib';
import { Wallet_ } from '@dialectlabs/web3';
import BN from 'bn.js';
require('isomorphic-fetch');

const makeSDK = (): TribecaSDK => {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const keypair: Keypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
  );
  const wallet = Wallet_.embedded(keypair.secretKey);
  const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
  const dialectConnection = new Connection(RPC_URL, 'recent');
  const dialectProvider = new Provider(
    dialectConnection,
    wallet,
    Provider.defaultOptions(),
  );

  const provider = SolanaProvider.load({
    connection: dialectProvider.connection,
    sendConnection: dialectProvider.connection,
    wallet: dialectProvider.wallet,
    opts: dialectProvider.opts,
  });
  return TribecaSDK.load({
    provider,
  });
};

async function run() {
  const data = await fetch(
    'https://raw.githubusercontent.com/TribecaHQ/tribeca-registry-build/master/registry/governor-metas.mainnet.json',
  );
  const tribecaDataJson = await data.json();

  console.log(tribecaDataJson[0].name);

  const tribecaSDK = makeSDK();

  let govDataPromisesArray = [];
  for (const daoData of tribecaDataJson) {
    const governorAddress = new PublicKey(daoData.address);
    const govWrapper = new GovernorWrapper(tribecaSDK, governorAddress);

    const govData = await govWrapper.data();

    console.log(`Monitoring data for: ${daoData.name}`);
    console.log(daoData.proposals);

    govDataPromisesArray.push({
      govData: govData,
      daoData: daoData,
    });
  }

  const govDataArray = await Promise.all(govDataPromisesArray);

  console.log(govDataArray);

  let proposalDetailPromises = [];

  for (const govData of govDataArray) {
    const governorAddress = new PublicKey(govData.daoData.address);
    const govWrapper = new GovernorWrapper(tribecaSDK, governorAddress);
    let indices = [];

    for (let i = 1; i <= govData.govData.proposalCount.toNumber(); i++) {
      indices.push(i);
    }
    console.log(govData.daoData.name, govData.daoData.slug);
    console.log(indices);
    const proposalPromises = indices.map(async (i) => {
      console.log('fetching data for: ', i);
      return await govWrapper.findProposalAddress(new BN(i));
    });

    const proposals = await Promise.all(proposalPromises);

    console.log(proposals);
    console.log(proposals.map((p) => p.toBase58()));

    for (const proposal of proposals) {
      proposalDetailPromises.push({
        proposalMeta: await govWrapper.fetchProposalMeta(proposal),
        daoData: govData.daoData,
        govData: govData.govData,
      });
    }
  }

  const proposalDetails = await Promise.all(proposalDetailPromises);

  console.log(proposalDetails);
}

run();
