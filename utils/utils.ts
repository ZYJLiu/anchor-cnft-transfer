import { Connection, Keypair, PublicKey } from "@solana/web3.js"
import fetch from "node-fetch"
import dotenv from "dotenv"
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js"
import {
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  ValidDepthSizePair,
  createAllocTreeIx,
  deserializeChangeLogEventV1,
} from "@solana/spl-account-compression"
import {
  PROGRAM_ID as BUBBLEGUM_PROGRAM_ID,
  MetadataArgs,
  TokenProgramVersion,
  TokenStandard,
  createCreateTreeInstruction,
  createMintV1Instruction,
  getLeafAssetId,
} from "@metaplex-foundation/mpl-bubblegum"
import { uris } from "./uri"
import base58 from "bs58"
import BN from "bn.js"
dotenv.config()

export async function createTree(
  connection: Connection,
  payer: Keypair,
  maxDepthSizePair: ValidDepthSizePair,
  canopyDepth: number
) {
  const treeKeypair = Keypair.generate()

  const [treeAuthority, _bump] = PublicKey.findProgramAddressSync(
    [treeKeypair.publicKey.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )

  const allocTreeIx = await createAllocTreeIx(
    connection,
    treeKeypair.publicKey,
    payer.publicKey,
    maxDepthSizePair,
    canopyDepth
  )

  const createTreeIx = createCreateTreeInstruction(
    {
      treeAuthority,
      merkleTree: treeKeypair.publicKey,
      payer: payer.publicKey,
      treeCreator: payer.publicKey,
      logWrapper: SPL_NOOP_PROGRAM_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    },
    {
      maxBufferSize: maxDepthSizePair.maxBufferSize,
      maxDepth: maxDepthSizePair.maxDepth,
      public: true,
    },
    BUBBLEGUM_PROGRAM_ID
  )

  try {
    const tx = new Transaction().add(allocTreeIx, createTreeIx)
    tx.feePayer = payer.publicKey

    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [treeKeypair, payer],
      {
        commitment: "confirmed",
        skipPreflight: true,
      }
    )

    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)

    console.log("Tree Address:", treeKeypair.publicKey.toBase58())

    return treeKeypair.publicKey
  } catch (err: any) {
    console.error("\nFailed to create merkle tree:", err)
    throw err
  }
}

export async function mintCompressedNFT(
  connection: Connection,
  payer: Keypair,
  treeAddress: PublicKey
) {
  // Compressed NFT Metadata
  const compressedNFTMetadata = createCompressedNFTMetadata(payer.publicKey)

  // Derive the tree authority PDA ('TreeConfig' account for the tree account)
  const [treeAuthority] = PublicKey.findProgramAddressSync(
    [treeAddress.toBuffer()],
    BUBBLEGUM_PROGRAM_ID
  )

  // Create the instruction to "mint" the compressed NFT to the tree
  const mintIx = createMintV1Instruction(
    {
      payer: payer.publicKey, // The account that will pay for the transaction
      merkleTree: treeAddress, // The address of the tree account
      treeAuthority, // The authority of the tree account, should be a PDA derived from the tree account address
      treeDelegate: payer.publicKey, // The delegate of the tree account, should be the same as the tree creator by default
      leafOwner: payer.publicKey, // The owner of the compressed NFT being minted to the tree
      leafDelegate: payer.publicKey, // The delegate of the compressed NFT being minted to the tree
      compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      logWrapper: SPL_NOOP_PROGRAM_ID,
    },
    {
      message: Object.assign(compressedNFTMetadata),
    }
  )

  try {
    // Create new transaction and add the instruction
    const tx = new Transaction().add(mintIx)

    // Set the fee payer for the transaction
    tx.feePayer = payer.publicKey

    // Send the transaction
    const txSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [payer],
      { commitment: "confirmed", skipPreflight: true }
    )

    console.log(`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`)

    const assetId = await extractAssetId(connection, txSignature, treeAddress)
    return assetId
  } catch (err) {
    console.error("\nFailed to mint compressed NFT:", err)
    throw err
  }
}

export function createCompressedNFTMetadata(creatorPublicKey: PublicKey) {
  // Select a random URI from uris
  const randomUri = uris[Math.floor(Math.random() * uris.length)]

  // Compressed NFT Metadata
  const compressedNFTMetadata: MetadataArgs = {
    name: "CNFT",
    symbol: "CNFT",
    uri: randomUri,
    creators: [{ address: creatorPublicKey, verified: false, share: 100 }],
    editionNonce: 0,
    uses: null,
    collection: null,
    primarySaleHappened: false,
    sellerFeeBasisPoints: 0,
    isMutable: false,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  }

  return compressedNFTMetadata
}

export async function extractAssetId(
  connection: Connection,
  txSignature: string,
  treeAddress: PublicKey
) {
  // Confirm the transaction, otherwise the getTransaction sometimes returns null
  const latestBlockHash = await connection.getLatestBlockhash()
  await connection.confirmTransaction({
    blockhash: latestBlockHash.blockhash,
    lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    signature: txSignature,
  })

  // Get the transaction info using the tx signature
  const txInfo = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  })

  // Function to check the program Id of an instruction
  const isProgramId = (instruction, programId) =>
    txInfo?.transaction.message.staticAccountKeys[
      instruction.programIdIndex
    ].toBase58() === programId

  // Find the index of the bubblegum instruction
  const relevantIndex =
    txInfo!.transaction.message.compiledInstructions.findIndex((instruction) =>
      isProgramId(instruction, BUBBLEGUM_PROGRAM_ID.toBase58())
    )

  // If there's no matching Bubblegum instruction, exit
  if (relevantIndex < 0) {
    return
  }

  // Get the inner instructions related to the bubblegum instruction
  const relevantInnerInstructions =
    txInfo!.meta?.innerInstructions?.[relevantIndex].instructions

  // Filter out the instructions that aren't no-ops
  const relevantInnerIxs = relevantInnerInstructions.filter((instruction) =>
    isProgramId(instruction, SPL_NOOP_PROGRAM_ID.toBase58())
  )

  // Locate the asset index by attempting to locate and parse the correct `relevantInnerIx`
  let assetIndex
  // Note: the `assetIndex` is expected to be at position `1`, and we normally expect only 2 `relevantInnerIx`
  for (let i = relevantInnerIxs.length - 1; i >= 0; i--) {
    try {
      // Try to decode and deserialize the instruction
      const changeLogEvent = deserializeChangeLogEventV1(
        Buffer.from(base58.decode(relevantInnerIxs[i]?.data!))
      )

      // extract a successful changelog index
      assetIndex = changeLogEvent?.index

      // If we got a valid index, no need to continue the loop
      if (assetIndex !== undefined) {
        break
      }
    } catch (__) {}
  }

  const assetId = await getLeafAssetId(treeAddress, new BN(assetIndex))

  console.log("Asset ID:", assetId.toBase58())

  return assetId
}

export async function heliusApi(method, params) {
  const response = await fetch(process.env.RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "my-id",
      method,
      params,
    }),
  })
  const { result } = await response.json()
  return result
}
