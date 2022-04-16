import { Connection, PublicKey, Keypair } from '@solana/web3.js';

import { TribecaSDK, findGovernorAddress, GovernorWrapper } from '@tribecahq/tribeca-sdk';
import {  } from '@tribecahq/registry';
import { Provider } from '@project-serum/anchor';
import {
  SolanaProvider,
} from "@saberhq/solana-contrib";
import { Wallet_ } from '@dialectlabs/web3';
import BN from "bn.js";

const makeSDK = (): TribecaSDK => {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const keypair: Keypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
  );
  const wallet = Wallet_.embedded(keypair.secretKey);
  const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
  console.log('RPC url', RPC_URL);
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
  const connection = new Connection(process.env.RPC_URL!);
  const programId = new PublicKey(
    'Govz1VyoyLD5BL6CSCxUJLVLsQHRwjfFj1prNsdNg5Jw',
  );

  const tribecaSDK = makeSDK();

  // console.log(tribecaSDK);

  const sbrAddress = new PublicKey('9tnpMysuibKx6SatcH3CWR9ZsSRMBNeBf1mhfL6gAXR4');

  // const sbrGov = await findGovernorAddress(sbrAddress);

  // console.log('sbr address: 9tnpMysuibKx6SatcH3CWR9ZsSRMBNeBf1mhfL6gAXR4');
  // console.log('sbrgovaddr:', sbrGov[0].toBase58());

  const govWrapper = new GovernorWrapper(tribecaSDK, sbrAddress);

  const govData = await govWrapper.data();

  console.log(govData.proposalCount.toNumber());

  // let proposals = [];

  // for (let i = 0; i < govData.proposalCount.toNumber(); i++) {
  //   proposals.append(govWrapper.fetchProposal(new BN(i)));
  // }

  const proposalPromises = [...Array(govData.proposalCount.toNumber()).keys()].map(async i =>
    await govWrapper.findProposalAddress(new BN(i))
  );

  const proposals = await Promise.all(proposalPromises);

  console.log(proposals);

  // console.log(proposals[0].instructions);

  const proposalMetadataPromises = proposals.slice(0, 10).map(async proposal => await govWrapper.fetchProposalMeta(proposal));
  const proposalMetadatas = await Promise.all(proposalMetadataPromises);

  console.log(proposalMetadatas);
}

run();
