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

interface DaoType {
  address: string;
  name: string;
  slug: string;
}

async function run() {
  const data = await fetch(
    'https://raw.githubusercontent.com/TribecaHQ/tribeca-registry-build/master/registry/governor-metas.mainnet.json',
  );
  const tribecaDataJson = await data.json();

  console.log(tribecaDataJson[0].name);

  const tribecaSDK = makeSDK();

  const govDataPromisesArray = tribecaDataJson.map(async (daoData: DaoType) => {
    const governorAddress = new PublicKey(daoData.address);
    const govWrapper = new GovernorWrapper(tribecaSDK, governorAddress);

    console.log(`Monitoring data for: ${daoData.name}`);

    return {
      govData: await govWrapper.data(),
      daoData: daoData,
    };
  });

  const govDataArray = await Promise.all(govDataPromisesArray);

  console.log(govDataArray);

  let proposals: any[] = [];

  for (const govData of govDataArray) {
    const governorAddress = new PublicKey(govData.daoData.address);
    const govWrapper = new GovernorWrapper(tribecaSDK, governorAddress);
    let indices = [];

    for (let i = 1; i <= govData.govData.proposalCount.toNumber(); i++) {
      indices.push(i);
      proposals.push({
        proposal: await govWrapper.findProposalAddress(new BN(i)),
        daoData: govData.daoData,
        govData: govData.govData,
        govWrapper: govWrapper,
      });
    }
  }

  console.log('proposalPromises: ', proposals);

  console.log(`fetched ${proposals.length} proposal public keys`);

  const proposalDetailPromises = proposals.map(async (proposal) => {
    try {
      return {
        proposalPk: proposal.proposal,
        proposalMeta: await proposal.govWrapper.fetchProposalMeta(
          proposal.proposal,
        ),
        daoData: proposal.daoData,
        govData: proposal.govData,
      };
    } catch {
      console.log(
        `Failed to fetch proposal with key: ${proposal.proposal.toBase58()} from DAO: ${
          proposal.daoData.name
        }.`,
      );
      return null;
    }
  });

  const proposalDetails = await Promise.all(proposalDetailPromises);

  const filteredProposals = proposalDetails.filter(
    (proposal) => proposal != null,
  );

  console.log('proposalDetails: ', proposalDetails);
  console.log('proposalDetails length: ', filteredProposals.length);
  console.log('we are at the end');
}

run();
